// stakingManager.js - FIXED: Use Helius RPC with timeout and retry

const admin = require('firebase-admin');
const solanaWeb3 = require('@solana/web3.js');

const db = admin.database();

// HELIUS RPC: From Railway environment variable
const SOLANA_RPC_ENDPOINT = process.env.SOLANA_RPC_ENDPOINT || 
  'https://mainnet.helius-rpc.com/?api-key=de2fb44b-73e1-4ee5-aa9d-b1134825a8b0';

// Create Solana connection with timeout
const createConnection = () => {
  return new solanaWeb3.Connection(
    SOLANA_RPC_ENDPOINT,
    {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,  // 60s timeout instead of default 30s
    }
  );
};

let connection = createConnection();

const INFINITE_MINT = new solanaWeb3.PublicKey('C8KsvkMBuqmvX416MWTJGKW9S9MpKiUjmpnj1fhzpump');
const HOT_WALLET = new solanaWeb3.PublicKey('4oxApVuuCi5QnUMELbi5bJ33L4BD6KxDb7D2YHYn8ww6');
const TOKEN_2022_PROGRAM_ID = new solanaWeb3.PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

// RETRY WRAPPER: Retry RPC calls up to 3 times on failure
async function withRetry(fn, maxRetries = 3, delayMs = 500) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(`[Staking] RPC attempt ${i + 1}/${maxRetries} failed:`, error.message);
      
      // Reconnect if connection seems broken
      if (i < maxRetries - 1) {
        connection = createConnection();
        await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}

// Send transaction with timeout
async function sendTransactionWithTimeout(tx, signers, timeoutMs = 60000) {
  return Promise.race([
    (async () => {
      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await withRetry(() =>
        connection.getLatestBlockhash('confirmed')
      );
      
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.sign(...signers);
      
      // Send transaction
      const txId = await withRetry(() =>
        connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
          maxRetries: 3
        })
      );
      
      console.log(`[Staking] Transaction sent: ${txId}`);
      
      // Confirm transaction with timeout
      return await withRetry(() =>
        connection.confirmTransaction(
          { signature: txId, blockhash, lastValidBlockHeight },
          'confirmed'
        )
      );
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Transaction timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

// Get account with retry
async function getAccount(publicKey, commitment = 'confirmed') {
  return withRetry(() =>
    connection.getAccountInfo(publicKey, commitment)
  );
}

// Get token account balance with retry
async function getTokenBalance(tokenAccount) {
  return withRetry(() =>
    connection.getTokenAccountBalance(tokenAccount)
  );
}

// Export functions
module.exports = {
  connection: () => connection,
  sendTransactionWithTimeout,
  getAccount,
  getTokenBalance,
  withRetry,
  SOLANA_RPC_ENDPOINT
};
