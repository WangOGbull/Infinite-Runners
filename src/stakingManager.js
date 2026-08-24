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
  Small: 10000,
  Medium: 100000,
  High: 1000000,
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

export const CUSTOM_STAKE_MIN = 1000;
export const CUSTOM_STAKE_MAX = 10000000;

// Resolves a tier name OR a numeric custom amount to a validated stake.
// Custom amounts are passed as { tier: 'Custom', customAmount: N } from the
// callers; a plain named tier ignores customAmount.
function tierAmount(tier, customAmount) {
  if (tier === 'Custom') {
    const n = Math.floor(Number(customAmount));
    if (!Number.isFinite(n)) throw new Error('Enter a valid custom stake amount.');
    if (n < CUSTOM_STAKE_MIN) throw new Error(`Minimum stake is ${CUSTOM_STAKE_MIN.toLocaleString()} INFINITE.`);
    if (n > CUSTOM_STAKE_MAX) throw new Error(`Maximum stake is ${CUSTOM_STAKE_MAX.toLocaleString()} INFINITE.`);
    return n;
  }
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

  // Polls getSignatureStatus directly to find out whether a transaction
  // whose CONFIRMATION WATCHER expired actually landed on-chain anyway.
  // This distinction is critical: "block height exceeded" only means the
  // confirmTransaction() strategy gave up waiting - the transaction itself
  // may still have been included in a block moments earlier. Treating that
  // as a failure (and retrying) would double-charge the player; treating a
  // genuine miss as success would record a deposit that never happened.
  // searchTransactionHistory:true is required so a tx that already slipped
  // out of the recent-status cache is still found.
  async _didTxLand(signature) {
    for (let i = 0; i < 4; i++) {
      try {
        const res = await this.connection.getSignatureStatus(signature, {
          searchTransactionHistory: true,
        });
        const st = res && res.value;
        if (st) {
          if (st.err) return false; // included but FAILED on-chain - funds not moved
          if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
            return true;
          }
          // Seen but only 'processed' - give it a moment to reach confirmed.
        }
      } catch (_) { /* transient RPC error - just poll again */ }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }

  // Builds, sends, and confirms one attempt with a blockhash fetched at
  // the last possible moment (immediately before the wallet prompt), so
  // the ~60-90s validity window is spent almost entirely on the user's
  // approval instead of being partially burned beforehand.
  async _sendTxOnce(instructions, pendingAction) {
    const connection = this.connection;
    const feePayer = this.walletManager.publicKey;

    const { blockhash, lastValidBlockHeight } = await _timed(
      'connection.getLatestBlockhash',
      () => connection.getLatestBlockhash('confirmed')
    );

    const tx = new solanaWeb3.Transaction({ feePayer, blockhash, lastValidBlockHeight });

    // Compute budget first so Phantom simulation succeeds.
    tx.add(COMPUTE_BUDGET_IX);
    instructions.forEach((ix) => tx.add(ix));

    const result = await _timed(
      'walletManager.sendTransaction',
      () => this.walletManager.sendTransaction(tx, pendingAction)
    );
    if (result?.deepLinked) return result;

    try {
      await _timed(
        'connection.confirmTransaction',
        () => connection.confirmTransaction({ signature: result.signature, blockhash, lastValidBlockHeight }, 'confirmed')
      );
      return result;
    } catch (err) {
      const expired =
        err?.name === 'TransactionExpiredBlockheightExceededError' ||
        /block height exceeded/i.test(err?.message || '');
      if (!expired) throw err;

      // The watcher gave up - find out what ACTUALLY happened on-chain.
      console.log('[Staking] confirmation window expired - checking whether the tx landed anyway…');
      const landed = await _timed(
        'connection.getSignatureStatus (post-expiry check)',
        () => this._didTxLand(result.signature)
      );
      if (landed) {
        // The deposit is real - only the watcher timed out. Success.
        console.log('[Staking] tx DID land on-chain - treating as confirmed:', result.signature);
        return result;
      }
      // Provably never included AND its blockhash is now past
      // lastValidBlockHeight, so it can never be included in the future
      // either. A retry with a fresh blockhash is therefore SAFE - the
      // expired signature and the retry's signature can never both land.
      const e = new Error('TX_EXPIRED_RETRYABLE');
      e._retryable = true;
      e._expiredSignature = result.signature;
      throw e;
    }
  }

  // Never launch a second wallet approval automatically. An automatic retry
  // is easy to miss after the wallet closes and can consume another full
  // blockhash window, which produced the confusing "expired twice" failure.
  //
  // _sendTxOnce has already checked the submitted signature before marking
  // an expiry retryable. Return a clear recoverable error and let the player
  // tap the existing Place Bet button again. That new user gesture rebuilds
  // the transaction with a completely fresh blockhash while the Auto Match
  // room and reservation remain untouched.
  async _sendTx(instructions, pendingAction) {
    try {
      return await this._sendTxOnce(instructions, pendingAction);
    } catch (err) {
      if (!err?._retryable) throw err;

      const retryError = new Error(
        'Your stake transaction expired before reaching Solana. No funds were moved. Tap Place Bet to try again with a fresh transaction.'
      );
      retryError.code = 'STAKE_EXPIRED_RETRY';
      retryError.retryable = true;
      retryError.expiredSignature = err._expiredSignature || null;
      throw retryError;
    }
  }

  async createStakedRoom({ roomId, tier, customAmount }) {
    const connection = this.connection;
    const hostPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier, customAmount);

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
      { type: 'createRoom', roomId, tier, customAmount: amount }
    );
  }

  async joinStakedRoom({ roomId, tier, customAmount }) {
    const connection = this.connection;
    const opponentPubkey = this.walletManager.publicKey;
    const amount = tierAmount(tier, customAmount);

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
      { type: 'joinRoom', roomId, tier, customAmount: amount }
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
