// stakingManager.js
//
// Talks directly to the infinite_arena Anchor program using @solana/web3.js only
// (no Anchor JS client, since this project loads solanaWeb3 via a plain <script>
// tag with no bundler). Instructions are built by hand: 8-byte sha256-based
// discriminators + manual borsh-style arg encoding, matching what `anchor build`
// generates on the Rust side.
//
// IMPORTANT: fill in PROGRAM_ID and TREASURY_TOKEN_ACCOUNT below after you run
// `anchor keys sync` + `initialize_config` on your deployed program. Nothing
// here will work against placeholder values.

const PROGRAM_ID_STR = 'HezS1VfaBjg4FHatf9UrYbjmt14kyPyBQhQUiU6ojLAA';
const TREASURY_TOKEN_ACCOUNT_STR = 'AeHeRAGnJ9gprjqX4VtbPxw6oHUC7Q9vsqF7vMX1VALK';
const INFINITE_MINT = new solanaWeb3.PublicKey('5B3WSHvvSSdcHcitSe9ihisoaUEEjRgJdvRy9J638r85'); // DEVNET TEST TOKEN - swap back to the real mint before Mainnet
const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSVAR_RENT_PUBKEY = new solanaWeb3.PublicKey('SysvarRent111111111111111111111111111111111');

// ---------------------------------------------------------------------
// TEMPORARY diagnostic aid: times every RPC round-trip in the staking flow
// and prints it to the console, so we can see exactly which call the
// multi-minute delay is coming from (our RPC calls before handing off to
// Phantom, vs Phantom's own simulation after that). Safe to remove once
// the delay is tracked down.
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

// PROGRAM_ID and the treasury account are only parsed the first time they're
// actually needed (not at module load) - so the rest of the page keeps working
// normally even before you've deployed the program and filled these in. Trying
// to use any staking feature before then throws a clear error instead of a
// cryptic "Non-base58 character" crash on page load.
let _programId = null;
function PROGRAM_ID() {
  if (!_programId) {
    if (PROGRAM_ID_STR.startsWith('REPLACE_')) {
      throw new Error('Staking is not configured yet: set PROGRAM_ID_STR in stakingManager.js to your deployed program address.');
    }
    _programId = new solanaWeb3.PublicKey(PROGRAM_ID_STR);
  }
  return _programId;
}

let _treasuryAccount = null;
function TREASURY_TOKEN_ACCOUNT() {
  if (!_treasuryAccount) {
    if (TREASURY_TOKEN_ACCOUNT_STR.startsWith('REPLACE_')) {
      throw new Error('Staking is not configured yet: set TREASURY_TOKEN_ACCOUNT_STR in stakingManager.js to your treasury ATA.');
    }
    _treasuryAccount = new solanaWeb3.PublicKey(TREASURY_TOKEN_ACCOUNT_STR);
  }
  return _treasuryAccount;
}

export const TIER = { Small: 0, Medium: 1, High: 2 };
export const TIER_NAMES = ['Small', 'Medium', 'High'];

// ---- byte helpers (no Buffer dependency - works in a plain browser tab) ----

function u8enc(str) {
  return new TextEncoder().encode(str);
}

function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function u64LE(value) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigUint64(0, BigInt(value), true);
  return buf;
}

function i64LE(value) {
  const buf = new Uint8Array(8);
  new DataView(buf.buffer).setBigInt64(0, BigInt(value), true);
  return buf;
}

function readU64LE(view, offset) {
  return view.getBigUint64(offset, true);
}

async function discriminator(instructionName) {
  const hash = await crypto.subtle.digest('SHA-256', u8enc('global:' + instructionName));
  return new Uint8Array(hash).slice(0, 8);
}

function findPda(seeds) {
  return solanaWeb3.PublicKey.findProgramAddressSync(seeds, PROGRAM_ID())[0];
}

function configPda() {
  return findPda([u8enc('config')]);
}

function roomPda(roomId) {
  return findPda([u8enc('room'), u64LE(roomId)]);
}

function vaultPda(roomId) {
  return findPda([u8enc('vault'), u64LE(roomId)]);
}

function getAssociatedTokenAddress(owner, mint = INFINITE_MINT) {
  return solanaWeb3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

function buildCreateAtaIx(payer, owner, ata, mint = INFINITE_MINT) {
  // The legacy zero-data "Create" instruction on the Associated Token Program.
  return new solanaWeb3.TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array(0),
  });
}

// Session-level cache: once we've confirmed a wallet's Associated Token
// Account exists, it will always exist (accounts don't get deleted), so
// there's no reason to spend an RPC round-trip re-checking it on every
// single stake attempt. Keyed by "ownerPubkey:mintPubkey".
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
  return { ata, instructions: [buildCreateAtaIx(payer, owner, ata, mint)] };
}

// ---- reading on-chain config so the UI never shows stale tier amounts ----

export async function fetchConfig(connection) {
  const info = await connection.getAccountInfo(configPda());
  if (!info) throw new Error('Config account not found - has initialize_config been run?');
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  // layout: 8 disc + 32*5 pubkeys + 2 fee_bps + 8*3 tiers + 1 bump
  const feeBpsOffset = 8 + 32 * 5;
  const tiersOffset = feeBpsOffset + 2;
  return {
    feeBps: view.getUint16(feeBpsOffset, true),
    tierSmall: readU64LE(view, tiersOffset),
    tierMedium: readU64LE(view, tiersOffset + 8),
    tierHigh: readU64LE(view, tiersOffset + 16),
  };
}

export async function fetchMintDecimals(connection, mint = INFINITE_MINT) {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error('Mint account not found');
  // SPL Mint layout: decimals is the single byte at offset 44.
  return info.data[44];
}

/** Human-readable "12.5 INFINITE" style formatting for a raw on-chain tier amount. */
export function formatTierAmount(rawAmount, decimals) {
  const value = Number(rawAmount) / Math.pow(10, decimals);
  return value.toLocaleString(undefined, { maximumFractionDigits: decimals });
}

// ---- instruction builders ----

async function buildCreateRoomIx({ hostPubkey, hostAta, roomId, tier, depositTimeoutSecs, settleTimeoutSecs }) {
  const data = concatBytes(
    await discriminator('create_room'),
    u64LE(roomId),
    new Uint8Array([TIER[tier]]),
    i64LE(depositTimeoutSecs),
    i64LE(settleTimeoutSecs)
  );
  const keys = [
    { pubkey: hostPubkey, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: INFINITE_MINT, isSigner: false, isWritable: false },
    { pubkey: hostAta, isSigner: false, isWritable: true },
    { pubkey: TREASURY_TOKEN_ACCOUNT(), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  return new solanaWeb3.TransactionInstruction({ keys, programId: PROGRAM_ID(), data });
}

async function buildJoinRoomIx({ opponentPubkey, opponentAta, roomId }) {
  const data = concatBytes(await discriminator('join_room'), u64LE(roomId));
  const keys = [
    { pubkey: opponentPubkey, isSigner: true, isWritable: true },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: opponentAta, isSigner: false, isWritable: true },
    { pubkey: TREASURY_TOKEN_ACCOUNT(), isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new solanaWeb3.TransactionInstruction({ keys, programId: PROGRAM_ID(), data });
}

async function buildMutualCancelIx({ hostPubkey, opponentPubkey, hostAta, opponentAta, roomId }) {
  const data = concatBytes(await discriminator('mutual_cancel_room'), u64LE(roomId));
  const keys = [
    { pubkey: hostPubkey, isSigner: true, isWritable: true },
    { pubkey: opponentPubkey, isSigner: true, isWritable: false },
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: hostAta, isSigner: false, isWritable: true },
    { pubkey: opponentAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new solanaWeb3.TransactionInstruction({ keys, programId: PROGRAM_ID(), data });
}

async function buildClaimDepositTimeoutIx({ hostPubkey, hostAta, roomId }) {
  const data = concatBytes(await discriminator('claim_deposit_timeout'), u64LE(roomId));
  const keys = [
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: hostAta, isSigner: false, isWritable: true },
    { pubkey: hostPubkey, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new solanaWeb3.TransactionInstruction({ keys, programId: PROGRAM_ID(), data });
}

async function buildClaimSettleTimeoutIx({ hostPubkey, hostAta, opponentAta, roomId }) {
  const data = concatBytes(await discriminator('claim_settle_timeout'), u64LE(roomId));
  const keys = [
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: hostAta, isSigner: false, isWritable: true },
    { pubkey: opponentAta, isSigner: false, isWritable: true },
    { pubkey: hostPubkey, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  return new solanaWeb3.TransactionInstruction({ keys, programId: PROGRAM_ID(), data });
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

    const tx = new solanaWeb3.Transaction({
      feePayer,
      blockhash,
      lastValidBlockHeight,
    });
    instructions.forEach((ix) => tx.add(ix));

    // On mobile without an injected provider, this redirects away to Phantom and
    // never resolves in this page load - completion is picked up later via the
    // 'wallet:txConfirmed' event once Phantom redirects back (see walletManager.js
    // and Game._restoreLobbyContext in main.js).
    //
    // On desktop (extension present), this is where the Phantom popup actually
    // opens. Everything above this line ran in OUR code first - if Phantom takes
    // a long time to even appear, check the timing logs above this one: if
    // getAccountInfo/getLatestBlockhash already took minutes, the delay is our
    // RPC, not Phantom. If those were fast and Phantom still took forever to
    // pop up, the delay is inside Phantom/the browser extension itself.
    const result = await _timed(
      'walletManager.sendTransaction (opens Phantom, waits for user + simulation)',
      () => this.walletManager.sendTransaction(tx, pendingAction)
    );
    if (result?.deepLinked) return result;

    await _timed(
      'connection.confirmTransaction',
      () => connection.confirmTransaction(
        { signature: result.signature, blockhash, lastValidBlockHeight },
        'confirmed'
      )
    );
    return result;
  }

  /** Host locks in a tier and deposits into a new escrow room. roomId = the 6-digit Firebase room code. */
  async createStakedRoom({ roomId, tier, depositTimeoutSecs = 300, settleTimeoutSecs = 900 }) {
    const connection = this.connection;
    const hostPubkey = this.walletManager.publicKey;
    // These two calls don't depend on each other's results - running them
    // in parallel instead of one after another roughly halves the wait
    // before we even get to redirecting to Phantom.
    const [{ ata: hostAta, instructions: ataIxs }, blockhashInfo] = await Promise.all([
      ensureAtaInstructions(connection, hostPubkey, hostPubkey),
      _timed('connection.getLatestBlockhash (parallel)', () => connection.getLatestBlockhash('confirmed')),
    ]);

    const createIx = await buildCreateRoomIx({
      hostPubkey,
      hostAta,
      roomId,
      tier,
      depositTimeoutSecs,
      settleTimeoutSecs,
    });

    return this._sendTx([...ataIxs, createIx], { type: 'createRoom', roomId, tier }, blockhashInfo);
  }

  /** Opponent deposits the exact tier amount already locked in by the host. */
  async joinStakedRoom({ roomId }) {
    const connection = this.connection;
    const opponentPubkey = this.walletManager.publicKey;
    const [{ ata: opponentAta, instructions: ataIxs }, blockhashInfo] = await Promise.all([
      ensureAtaInstructions(connection, opponentPubkey, opponentPubkey),
      _timed('connection.getLatestBlockhash (parallel)', () => connection.getLatestBlockhash('confirmed')),
    ]);

    const joinIx = await buildJoinRoomIx({ opponentPubkey, opponentAta, roomId });
    return this._sendTx([...ataIxs, joinIx], { type: 'joinRoom', roomId }, blockhashInfo);
  }

  /** Both players back out after both deposited but before the match starts. Needs both wallets connected. */
  async mutualCancel({ roomId, hostPubkey, opponentPubkey }) {
    const hostAta = getAssociatedTokenAddress(hostPubkey);
    const opponentAta = getAssociatedTokenAddress(opponentPubkey);
    const ix = await buildMutualCancelIx({ hostPubkey, opponentPubkey, hostAta, opponentAta, roomId });
    return this._sendTx([ix], { type: 'mutualCancel', roomId });
  }

  /** Permissionless: reclaim the host's stake once the deposit deadline has passed with no opponent. */
  async claimDepositTimeout({ roomId, hostPubkey }) {
    const hostAta = getAssociatedTokenAddress(hostPubkey);
    const ix = await buildClaimDepositTimeoutIx({ hostPubkey, hostAta, roomId });
    return this._sendTx([ix], { type: 'claimDepositTimeout', roomId });
  }

  /** Permissionless: split refund once both deposited but the server never settled in time. */
  async claimSettleTimeout({ roomId, hostPubkey, opponentPubkey }) {
    const hostAta = getAssociatedTokenAddress(hostPubkey);
    const opponentAta = getAssociatedTokenAddress(opponentPubkey);
    const ix = await buildClaimSettleTimeoutIx({ hostPubkey, hostAta, opponentAta, roomId });
    return this._sendTx([ix], { type: 'claimSettleTimeout', roomId });
  }

  async getDisplayTiers() {
    const [config, decimals] = await Promise.all([
      fetchConfig(this.connection),
      fetchMintDecimals(this.connection),
    ]);
    return {
      Small: formatTierAmount(config.tierSmall, decimals),
      Medium: formatTierAmount(config.tierMedium, decimals),
      High: formatTierAmount(config.tierHigh, decimals),
      feePercent: config.feeBps / 100,
    };
  }
}

export default StakingManager;
