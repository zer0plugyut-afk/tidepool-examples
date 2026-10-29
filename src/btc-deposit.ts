// Cross-chain: deposit Bitcoin testnet4 BTC, receive NEAR testnet USDC.
// Needs a testnet4 key with a little tBTC (Tidepool never drips BTC: https://cypherfaucet.com/btc-testnet or https://testnet4.info).
//   BTC_PRIVATE_KEY_WIF='c...' RECIPIENT=you.testnet npm run btc-deposit     (testnet-only key! omit it to generate a fresh one and print its address)
// BTC is capped at 0.005 BTC per swap (minimum 0.0001) on Tidepool's Bitcoin bridge. AMOUNT (BTC, default 0.0005).
// Bitcoin has no memos: every quote gets its own deposit address, so no depositMode and no memo. Send a plain transfer to quote.depositAddress.
// The relayer credits the deposit after 1 confirmation (testnet4 blocks take ~10 minutes, polling waits up to 40 minutes).
import { api, poll, say, units } from './lib.js';
import { wallet, newWif, send, balance, btcExplorer } from './btc-lib.js';

const wif = process.env.BTC_PRIVATE_KEY_WIF || newWif();
const w = wallet(wif);
const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const AMOUNT = process.env.AMOUNT || '0.0005';
if (!process.env.BTC_PRIVATE_KEY_WIF) { say('no BTC_PRIVATE_KEY_WIF set: fund this testnet4 address, then re-run with the key printed below'); say('address', w.address, 'WIF', wif); process.exit(0); }

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'BTC' && t.blockchain === 'btc'), tOut = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!tIn) throw new Error('this Tidepool server has no Bitcoin testnet4 bridge');
say('Bitcoin', w.address, 'confirmed sats', await balance(w.address), 'asset', tIn.assetId);

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'ORIGIN_CHAIN', refundTo: w.address, refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 3600_000).toISOString(),
});
say('depositAddress', q.quote.depositAddress, 'amountIn', q.quote.amountInFormatted, 'BTC -> ', q.quote.amountOutFormatted, 'USDC');
const txid = await send(w, q.quote.depositAddress, Number(q.quote.amountIn));
say('deposit tx', btcExplorer(txid));
await api('POST', '/v0/deposit/submit', { txHash: txid, depositAddress: q.quote.depositAddress });
const st = await poll(q.quote.depositAddress, 2_400_000);
say('result', st.status, JSON.stringify(st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);
