// Cross-chain: deposit devnet SOL on Solana, receive NEAR testnet USDC.
// Needs a Solana devnet key with a little devnet SOL (the Tidepool faucet drips Solana USDC/USDT, not SOL: use your own devnet airdrop).
//   SOL_SECRET_KEY='[12,34,...]' RECIPIENT=you.testnet npm run sol-deposit     (a JSON array secret key, devnet only!)
// SOL is capped at 0.005 SOL per swap on Tidepool's Solana devnet bridge; the minimum is ~0.00089 SOL (rent-exempt minimum).
// AMOUNT (SOL, default 0.002). SOL_RPC overrides the public devnet RPC. Never use a key that holds mainnet funds.
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { api, poll, say, units } from './lib.js';

if (!process.env.SOL_SECRET_KEY) throw new Error('set SOL_SECRET_KEY (a devnet-only JSON array secret key with a little devnet SOL)');
const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const AMOUNT = process.env.AMOUNT || '0.002';
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.SOL_SECRET_KEY)));
const conn = new Connection(process.env.SOL_RPC || 'https://api.devnet.solana.com', 'confirmed');

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'SOL' && t.blockchain === 'sol'), tOut = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!tIn) throw new Error('this Tidepool server has no Solana devnet bridge');
say('Solana', payer.publicKey.toBase58(), 'asset', tIn.assetId);

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'ORIGIN_CHAIN', refundTo: payer.publicKey.toBase58(), refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 1800_000).toISOString(),
});
say('depositAddress', q.quote.depositAddress, 'amountIn', q.quote.amountInFormatted, 'SOL -> ', q.quote.amountOutFormatted, 'USDC');
const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: new PublicKey(q.quote.depositAddress), lamports: BigInt(q.quote.amountIn) }));
const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' });
say('deposit tx', `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
await api('POST', '/v0/deposit/submit', { txHash: sig, depositAddress: q.quote.depositAddress });
const st = await poll(q.quote.depositAddress, 900_000);
say('result', st.status, JSON.stringify(st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);
