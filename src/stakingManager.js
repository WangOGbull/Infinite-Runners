// stakingManager.js
//
// FIX: staking no longer goes through the infinite_arena on-chain program.
// That program's account types only understand the legacy SPL Token
// standard, but INFINITE is a Token-2022 mint - incompatible.
//
// Staking now works as a plain wallet-to-wallet transfer: the player sends
// their stake directly to a dedicated HOT WALLET. The backend pays out
// winners / refunds draws automatically once a match is decided.

const INFINITE_MINT = new solanaWeb3.PublicKey('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
const DECIMALS = 6;

const HOT_WALLET = new solanaWeb3.PublicKey('4oxApVuuCi5QnUMELbi5bJ33L4BD6KxDb7D2YHYn8ww6');

const TOKEN_2022_PROGRAM_ID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

export const TIER_AMOUNTS = {
  Small: 500000,
  Medium: 2000000,
  High: 5000000,
};
export const TIER_NAMES = ['Small', 'Medium', 'High'];

// ---------------------------------------------------------------------
// Token-2022 transfers + ATA creation can exceed default compute limits.
// Explicit budget prevents Phantom "simulation failed" errors.
// ---------------------------------------------------------------------
const COMPUTE_BUDGET_IX = solanaWeb3.ComputeBudgetProgram.setComputeUnitLimit({
  units: 200000,
});

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

export function formatTierAmount(tier) {
  return tierAmount(tier).toLocaleString();
}

function getAssociatedTokenAddress(owner, mint = INFINITE_MINT) {
  return solanaWeb3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

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
  return { ata, instructions: [buildCreateAtaIdempotentIx(payer, owner, ata, mint)] };
}

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

// ---------------------------------------------------------------------
// FIX: _sendTx now fetches the blockhash FRESH right before building the
// transaction, instead of using a stale pre-fetched one. This eliminates
// "Signature has expired: block height exceeded" on mobile.
// ---------------------------------------------------------------------
class StakingManager {
  constructor(eventBus, walletManager) {
    this.eventBus = eventBus;
    this.walletManager = walletManager;
  }

  get connection() {
    return this.walletManager.connection;
  }

  async _sendTx(instructions, pendingAction) {
    const connection = this.connection;
    const feePayer = this.walletManager.publicKey;

    // FIX: Fetch blockhash HERE, right before building — not earlier.
    // This minimizes the time between fetch and user approval in Phantom.
    const { blockhash, lastValidBlockHeight } = await _timed(
      'connection.getLatestBlockhash',
      () => connection.getLatestBlockhash('confirmed')
    );

    const tx = new solanaWeb3.Transaction({ feePayer, blockhash, lastValidBlockHeight });

    // FIX: Add compute budget first so Phantom simulation succeeds.
    tx.add(COMPUTE_BUDGET_IX);
    instructions.forEach((ix) => tx.add(ix));

    const result = await _timed(
      'walletManager.sendTransaction',
      () => this.walletManager.sendTransaction(tx, pendingAction)
    );
    if (result?.deepLinked) return result;

    await _timed(
      'connection.confirmTransaction',
      () => connection.confirmTransaction({ signature: result.signature, blockhash, lastValidBlockHeight }, 'confirmed')
    );
    return result;
  }

  async createStakedRoom({ roomId, tier }) {
    const connection = this.connection;
    const hostPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier);

    // FIX: No more parallel blockhash fetch. Only fetch ATA info here.
    const { ata: hostAta, instructions: ataIxs } = await ensureAtaInstructions(
      connection, hostPubkey, hostPubkey
    );

    const hotWalletAta = getAssociatedTokenAddress(HOT_WALLET);
    const ensureHotWalletAtaIx = buildCreateAtaIdempotentIx(hostPubkey, HOT_WALLET, hotWalletAta);

    const transferIx = buildTransferCheckedIx({
      source: hostAta,
      destination: hotWalletAta,
      owner: hostPubkey,
      amountBaseUnits: toBaseUnits(amount),
    });

    return this._sendTx(
      [...ataIxs, ensureHotWalletAtaIx, transferIx],
      { type: 'createRoom', roomId, tier }
    );
  }

  async joinStakedRoom({ roomId, tier }) {
    const connection = this.connection;
    const opponentPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier);

    // FIX: No more parallel blockhash fetch.
    const { ata: opponentAta, instructions: ataIxs } = await ensureAtaInstructions(
      connection, opponentPubkey, opponentPubkey
    );

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
      { type: 'joinRoom', roomId, tier }
    );
  }

  async getDisplayTiers() {
    return {
      Small: formatTierAmount('Small'),
      Medium: formatTierAmount('Medium'),
      High: formatTierAmount('High'),
      feePercent: 5.0,
    };
  }

  async getRoomAccount(_roomId) {
    return { exists: false };
  }
}

export default StakingManager;
