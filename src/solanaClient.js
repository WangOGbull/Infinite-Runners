// solanaClient.js
// Server-only Solana client for the infinite_arena program. This module is the
// ONE place server_authority ever signs a transaction - it must never be
// imported into client-facing code. Deployed as part of Firebase Cloud
// Functions, where the keypair lives in Firebase secrets, not in source.

const {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const crypto = require('crypto');

const RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT; // set via Firebase secret/config
const PROGRAM_ID = new PublicKey(process.env.ARENA_PROGRAM_ID);
const INFINITE_MINT = new PublicKey('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

function loadServerAuthority() {
  // SERVER_AUTHORITY_SECRET_KEY = JSON array string, e.g. "[12,34,...]" (64 bytes).
  // Set via `firebase functions:secrets:set SERVER_AUTHORITY_SECRET_KEY`.
  const raw = process.env.SERVER_AUTHORITY_SECRET_KEY;
  if (!raw) throw new Error('SERVER_AUTHORITY_SECRET_KEY is not set.');
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

function getConnection() {
  return new Connection(RPC_ENDPOINT, 'confirmed');
}

function u64LE(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function discriminator(instructionName) {
  return crypto.createHash('sha256').update(`global:${instructionName}`).digest().slice(0, 8);
}

function findPda(seeds) {
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
}

function configPda() {
  return findPda([Buffer.from('config')]);
}
function roomPda(roomId) {
  return findPda([Buffer.from('room'), u64LE(roomId)]);
}
function vaultPda(roomId) {
  return findPda([Buffer.from('vault'), u64LE(roomId)]);
}

function getAssociatedTokenAddress(owner, mint = INFINITE_MINT) {
  const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/**
 * Calls settle_match. This is the only function in the whole system that
 * pays out a winner - guard every caller of this carefully.
 */
async function settleMatch({ roomId, winnerPubkeyStr, hostPubkeyStr }) {
  const connection = getConnection();
  const serverAuthority = loadServerAuthority();
  const winner = new PublicKey(winnerPubkeyStr);
  const host = new PublicKey(hostPubkeyStr);
  const winnerAta = getAssociatedTokenAddress(winner);

  const data = Buffer.concat([discriminator('settle_match'), u64LE(roomId), winner.toBuffer()]);

  const keys = [
    { pubkey: serverAuthority.publicKey, isSigner: true, isWritable: false },
    { pubkey: configPda(), isSigner: false, isWritable: false },
    { pubkey: roomPda(roomId), isSigner: false, isWritable: true },
    { pubkey: vaultPda(roomId), isSigner: false, isWritable: true },
    { pubkey: winnerAta, isSigner: false, isWritable: true },
    { pubkey: host, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
  const tx = new Transaction().add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [serverAuthority], {
    commitment: 'confirmed',
  });
  return signature;
}

module.exports = {
  getConnection,
  configPda,
  roomPda,
  vaultPda,
  settleMatch,
  PROGRAM_ID,
};
