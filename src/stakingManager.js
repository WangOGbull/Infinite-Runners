// stakingManager.js
//
// FIX: staking no longer goes through the infinite_arena on-chain program.
// That program's account types only understand the legacy SPL Token
// standard, but INFINITE is a Token-2022 mint (confirmed directly from its
// raw account data - Owner: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb,
// 414 bytes, not the fixed 82-byte legacy layout) - incompatible, and the
// program's upgrade authority is separately, permanently unrecoverable, so
// it can never be fixed or redeployed under that same address either.
//
// Staking now works as a plain wallet-to-wallet transfer: the player's own
// wallet sends their stake directly to a dedicated HOT WALLET (public
// address only, below - safe to know publicly, unlike its private key).
// The backend (watchMatches.js + hotWalletSettlement.js) holds the
// matching private key and pays out winners / refunds draws automatically
// once a match is decided.
//
// KNOWN GAP, on purpose, not an oversight: the old on-chain program had
// automatic, code-enforced deposit-timeout and settle-timeout refunds -
// "anyone can trigger this, funds always come back, no one can get stuck
// waiting on a person." None of that exists anymore. If a match never
// resolves normally right now, getting a stuck stake back requires manual
// backend intervention, not an automatic on-chain claim. This is an
// accepted tradeoff for shipping staking sooner, not something quietly
// dropped - flag if you want this rebuilt as a backend feature later.

const INFINITE_MINT = new solanaWeb3.PublicKey('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
// Confirmed directly from the mint's raw on-chain data (byte 44 = 0x06).
const DECIMALS = 6;

// Public address only - safe to embed in frontend code that every player's
// browser downloads. The matching PRIVATE key lives ONLY in the backend's
// HOT_WALLET_SECRET_KEY environment variable and must never appear here.
const HOT_WALLET = new solanaWeb3.PublicKey('4oxApVuuCi5QnUMELbi5bJ33L4BD6KxDb7D2YHYn8ww6');

// INFINITE is a Token-2022 mint, not legacy SPL Token - every account and
// instruction below has to be built against this program ID specifically,
// or the transaction will simply fail (the two token programs are not
// interchangeable, confirmed the hard way earlier tonight).
const TOKEN_2022_PROGRAM_ID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// Stake tiers, in human INFINITE units. No on-chain Config account exists
// anymore to source these from - this IS the source of truth now. Keep
// this in sync manually with the matching TIER_AMOUNTS in the backend's
// hotWalletSettlement.js - if you change one, change both.
export const TIER_AMOUNTS = {
  Small: 500000,
  Medium: 2000000,
  High: 5000000,
};
export const TIER_NAMES = ['Small', 'Medium', 'High'];

// ---------------------------------------------------------------------
// TEMPORARY diagnostic aid, carried over from the old version: times every
// RPC round-trip so a slow step shows up in the console instead of just
// "this is taking forever" with no clue why.
// ---------------------------------------------------------------------
async function _timed(label, promiseFactory) {
  const start = performance.now();
  console.log(`[Staking][timing] START ${label}`);
  try {
    const result = await promiseFactory();
    const ms = Math.round(performance.now() - start);
    console.log(`[Staking][timing] DONE  ${label} (${ms}ms)`);
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    console.log(`[Staking][timing] FAILED ${label} after ${ms}ms:`, err?.message || err);
    throw err;
  }
}

function tierAmount(tier) {
  const amount = TIER_AMOUNTS[tier];
  if (!amount) throw new Error(`Unknown stake tier: "${tier}"`);
  return amount;
}

function toBaseUnits(humanAmount) {
  return BigInt(Math.round(humanAmount * 10 ** DECIMALS));
}

/** Human-readable "500,000" style formatting - no chain call needed anymore. */
export function formatTierAmount(tier) {
  return tierAmount(tier).toLocaleString();
}

function getAssociatedTokenAddress(owner, mint = INFINITE_MINT) {
  return solanaWeb3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// Idempotent "create this ATA if it doesn't already exist" - instruction
// index 1 on the Associated Token Account program (index 0 / empty data is
// the older, non-idempotent "Create", which errors if the account already
// exists; idempotent is the safer default here since we can't always know
// in advance whether an account exists without an extra RPC round-trip).
function buildCreateAtaIdempotentIx(payer, owner, ata, mint = INFINITE_MINT) {
  return new solanaWeb3.TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([1]),
  });
}

// Session-level cache: once an ATA is confirmed to exist, it always will,
// so there's no reason to spend an RPC round-trip re-checking it on every
// single stake attempt.
const _knownAtaCache = new Map();

async function ensureAtaInstructions(connection, payer, owner, mint = INFINITE_MINT) {
  const ata = getAssociatedTokenAddress(owner, mint);
  const cacheKey = `${owner.toString()}:${mint.toString()}`;
  if (_knownAtaCache.has(cacheKey)) {
    return { ata, instructions: [] };
  }
  const info = await _timed('connection.getAccountInfo(ata)', () => connection.getAccountInfo(ata));
  if (info) {
    _knownAtaCache.set(cacheKey, true);
    return { ata, instructions: [] };
  }
  // Idempotent, so this is safe even if the ATA gets created by someone/
  // something else in the moment between our check and our tx landing.
  return { ata, instructions: [buildCreateAtaIdempotentIx(payer, owner, ata, mint)] };
}

// Token-2022's TransferChecked (instruction index 12). "Checked" transfers
// require passing the mint + decimals explicitly, which the token program
// verifies against - the correct, safer choice here over a plain unchecked
// Transfer, and required for some Token-2022 extensions to work correctly
// even when not strictly enforced.
function buildTransferCheckedIx({ source, destination, owner, amountBaseUnits, mint = INFINITE_MINT, decimals = DECIMALS }) {
  const data = new Uint8Array(1 + 8 + 1);
  data[0] = 12;
  new DataView(data.buffer).setBigUint64(1, BigInt(amountBaseUnits), true);
  data[9] = decimals;
  return new solanaWeb3.TransactionInstruction({
    programId: TOKEN_2022_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

// ---- high-level actions used by main.js ----

class StakingManager {
  constructor(eventBus, walletManager) {
    this.eventBus = eventBus;
    this.walletManager = walletManager;
  }

  get connection() {
    return this.walletManager.connection;
  }

  async _sendTx(instructions, pendingAction, prefetchedBlockhashInfo) {
    const connection = this.connection;
    const feePayer = this.walletManager.publicKey;
    const { blockhash, lastValidBlockHeight } = prefetchedBlockhashInfo || await _timed(
      'connection.getLatestBlockhash',
      () => connection.getLatestBlockhash('confirmed')
    );

    const tx = new solanaWeb3.Transaction({ feePayer, blockhash, lastValidBlockHeight });
    instructions.forEach((ix) => tx.add(ix));

    // On mobile without an injected provider, this redirects away to the
    // wallet app and never resolves in this page load - completion is
    // picked up later via 'wallet:txConfirmed' once it redirects back.
    const result = await _timed(
      'walletManager.sendTransaction (opens wallet, waits for user + simulation)',
      () => this.walletManager.sendTransaction(tx, pendingAction)
    );
    if (result?.deepLinked) return result;

    await _timed(
      'connection.confirmTransaction',
      () => connection.confirmTransaction({ signature: result.signature, blockhash, lastValidBlockHeight }, 'confirmed')
    );
    return result;
  }

  /**
   * Host locks in a tier and sends their FULL stake directly to the hot
   * wallet - no fee is taken at this step. The 2.5% fee is split off only
   * when the winner is actually paid (see hotWalletSettlement.js on the
   * backend). Simpler than the old two-transfer on-chain deposit, and it
   * means a draw refund can just return the exact amount sent, with no fee
   * math to reverse.
   */
  async createStakedRoom({ roomId, tier }) {
    const connection = this.connection;
    const hostPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier);

    const [{ ata: hostAta, instructions: ataIxs }, blockhashInfo] = await Promise.all([
      ensureAtaInstructions(connection, hostPubkey, hostPubkey),
      _timed('connection.getLatestBlockhash (parallel)', () => connection.getLatestBlockhash('confirmed')),
    ]);

    const hotWalletAta = getAssociatedTokenAddress(HOT_WALLET);
    // The hot wallet's own ATA might not exist yet the very first time
    // anyone ever stakes - the depositing player covers creating it if so.
    // Idempotent, so a no-op on every deposit after the first.
    const ensureHotWalletAtaIx = buildCreateAtaIdempotentIx(hostPubkey, HOT_WALLET, hotWalletAta);

    const transferIx = buildTransferCheckedIx({
      source: hostAta,
      destination: hotWalletAta,
      owner: hostPubkey,
      amountBaseUnits: toBaseUnits(amount),
    });

    return this._sendTx(
      [...ataIxs, ensureHotWalletAtaIx, transferIx],
      { type: 'createRoom', roomId, tier },
      blockhashInfo
    );
  }

  /** Opponent sends the exact same tier amount the host already staked. */
  async joinStakedRoom({ roomId, tier }) {
    const connection = this.connection;
    const opponentPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier);

    const [{ ata: opponentAta, instructions: ataIxs }, blockhashInfo] = await Promise.all([
      ensureAtaInstructions(connection, opponentPubkey, opponentPubkey),
      _timed('connection.getLatestBlockhash (parallel)', () => connection.getLatestBlockhash('confirmed')),
    ]);

    const hotWalletAta = getAssociatedTokenAddress(HOT_WALLET);
    const ensureHotWalletAtaIx = buildCreateAtaIdempotentIx(opponentPubkey, HOT_WALLET, hotWalletAta);

    const transferIx = buildTransferCheckedIx({
      source: opponentAta,
      destination: hotWalletAta,
      owner: opponentPubkey,
      amountBaseUnits: toBaseUnits(amount),
    });

    return this._sendTx(
      [...ataIxs, ensureHotWalletAtaIx, transferIx],
      { type: 'joinRoom', roomId, tier },
      blockhashInfo
    );
  }

  /**
   * No on-chain Config account exists anymore to read tiers/fee from -
   * this just returns the hardcoded values. Kept async (even with nothing
   * to await) so main.js's existing `.then(tiers => ...)` call site works
   * unchanged.
   */
  async getDisplayTiers() {
    return {
      Small: formatTierAmount('Small'),
      Medium: formatTierAmount('Medium'),
      High: formatTierAmount('High'),
      feePercent: 2.5,
    };
  }

  /**
   * FIX: previously read a Room PDA directly from chain to self-heal
   * Firebase's staking flags if a mobile redirect dropped confirmation
   * data. There is no on-chain Room account anymore to read - this now
   * always reports "nothing to reconcile," which main.js's
   * _syncStakeFromChain() already treats as a safe no-op (its existing
   * `if (!onChain.exists) return;` check). Not a crash, just a real,
   * known gap: mobile deposits that get dropped mid-redirect no longer
   * self-heal automatically. Worth rebuilding later by having this check
   * the hot wallet's own recent transaction history instead, if it turns
   * out to matter in practice.
   */
  async getRoomAccount(_roomId) {
    return { exists: false };
  }
}

export default StakingManager;
