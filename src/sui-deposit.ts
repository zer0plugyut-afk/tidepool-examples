// Cross-chain: deposit Sui testnet SUI, receive NEAR testnet USDC.
// Needs a Sui testnet key with a little SUI (the Tidepool faucet drips Sui USDC/USDT, not SUI: get gas from https://faucet.sui.io).
//   SUI_SECRET_KEY='suiprivkey1...' RECIPIENT=you.testnet npm run sui-deposit     (testnet-only key!)
// SUI is capped at 10 SUI per swap on Tidepool's Sui testnet bridge. AMOUNT (SUI, default 0.5).
// Sui has no memos: every quote gets its own deposit address, so no depositMode and no memo. Send a plain SUI transfer to quote.depositAddress.
// SUI_GRPC overrides the public testnet fullnode.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { api, poll, say, units } from './lib.js';
import { run, suiscan } from './sui-lib.js';

if (!process.env.SUI_SECRET_KEY) throw new Error('set SUI_SECRET_KEY (a testnet-only suiprivkey1... key with a little testnet SUI)');
const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const AMOUNT = process.env.AMOUNT || '0.5';
const signer = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUI_SECRET_KEY).secretKey);

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'SUI' && t.blockchain === 'sui'), tOut = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!tIn) throw new Error('this Tidepool server has no Sui testnet bridge');
say('Sui', signer.toSuiAddress(), 'asset', tIn.assetId);

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'ORIGIN_CHAIN', refundTo: signer.toSuiAddress(), refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 1800_000).toISOString(),
});
say('depositAddress', q.quote.depositAddress, 'amountIn', q.quote.amountInFormatted, 'SUI -> ', q.quote.amountOutFormatted, 'USDC');
const digest = await run(signer, tx => { const [coin] = tx.splitCoins(tx.gas, [BigInt(q.quote.amountIn)]); tx.transferObjects([coin], q.quote.depositAddress); });
say('deposit tx', suiscan(digest));
await api('POST', '/v0/deposit/submit', { txHash: digest, depositAddress: q.quote.depositAddress });
const st = await poll(q.quote.depositAddress, 900_000);
say('result', st.status, JSON.stringify(st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);
