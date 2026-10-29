// Testnet e2e for the Tidepool Bitcoin testnet4 bridge. Modes: reject | faucet | btc2near | near2btc | refund. Never prints keys.
//   TIDEPOOL_URL=https://www.usetidepool.tech npx tsx e2e-btc.ts btc2near
// The payer is a throwaway testnet4 key kept in /tmp/btc-payer.json (or BTC_PRIVATE_KEY_WIF). It needs a little tBTC: fund its printed address at
// https://cypherfaucet.com/btc-testnet (Tidepool never drips BTC). The script waits for a confirmed balance and the 1-confirmation sweep.
import fs from 'node:fs';
import { wallet, newWif, send, balance, btcExplorer } from './src/btc-lib.js';
import { api, call, account, depositIntents, poll, say, units, explorer, faucet } from './src/lib.js';

const mode = process.argv[2];
const keyFile = '/tmp/btc-payer.json';
const wif = process.env.BTC_PRIVATE_KEY_WIF || (fs.existsSync(keyFile) ? JSON.parse(fs.readFileSync(keyFile, 'utf8')).wif : (() => { const k = newWif(); fs.writeFileSync(keyFile, JSON.stringify({ wif: k }), { mode: 0o600 }); return k; })());
const w = wallet(wif), me = w.address;

const tokens = await api('GET', '/v0/tokens');
const btcT = tokens.find((t: any) => t.symbol === 'BTC' && t.blockchain === 'btc'), usdcN = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!btcT) throw new Error('Bitcoin not listed');
const quote = (o: any) => call('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 3600_000).toISOString(), ...o });
const summary = (st: any) => console.log(JSON.stringify({ status: st.status, near: st.swapDetails?.nearTxHashes, origin: st.swapDetails?.originChainTxHashes, dest: st.swapDetails?.destinationChainTxHashes, refunded: st.swapDetails?.refundedAmountFormatted, in: st.swapDetails?.amountInFormatted, out: st.swapDetails?.amountOutFormatted, explorer: st.tidepool?.explorer }, null, 1));
async function needFunds(sats: number) {
  say('payer', me, 'confirmed sats', await balance(me));
  for (let i = 0; i < 120 && (await balance(me)) < sats; i++) { if (i === 0) say(`waiting for ${sats} confirmed sats at ${me} (https://cypherfaucet.com/btc-testnet)`); await new Promise(r => setTimeout(r, 15_000)); }
  if ((await balance(me)) < sats) throw new Error('payer is not funded');
}

if (mode === 'reject') {
  const acc = await account();
  const over = await quote({ originAsset: btcT.assetId, destinationAsset: usdcN.assetId, amount: units('0.00500001', 8), refundTo: me, recipient: acc.accountId });
  say('quote 0.00500001 BTC in ->', over.status, over.body?.message); if (over.status !== 400) process.exit(1);
  const dust = await quote({ originAsset: btcT.assetId, destinationAsset: usdcN.assetId, amount: units('0.00005', 8), refundTo: me, recipient: acc.accountId });
  say('quote 0.00005 BTC in (below the minimum) ->', dust.status, dust.body?.message); if (dust.status !== 400) process.exit(1);
  const over2 = await quote({ originAsset: usdcN.assetId, destinationAsset: btcT.assetId, amount: units('100000', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: me });
  say('quote huge USDC -> >0.005 BTC out ->', over2.status, over2.body?.message); if (over2.status !== 400) process.exit(1);
  const bad = await quote({ originAsset: usdcN.assetId, destinationAsset: btcT.assetId, amount: units('1', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq' });
  say('quote with a mainnet BTC recipient ->', bad.status, bad.body?.message); if (bad.status !== 400) process.exit(1);
} else if (mode === 'faucet') {
  const f = await call('POST', '/v0/faucet', { chain: 'btc', address: me });
  say('chain btc faucet ->', f.status, f.body?.message); if (f.status !== 400) process.exit(1);
  const acc = await account();
  const i = await call('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents', assets: ['btc'] });
  say('intents alias btc ->', i.status, i.body?.message); if (i.status !== 400) process.exit(1);
} else if (mode === 'btc2near' || mode === 'refund') {
  const refund = mode === 'refund';
  const depositSats = Number(process.env.DEPOSIT_SATS || 40_000);
  await needFunds(depositSats + 3_000);
  const acc = await account();
  const q = await quote({ originAsset: btcT.assetId, destinationAsset: usdcN.assetId, amount: String(depositSats), refundTo: me, recipient: acc.accountId, ...(refund ? { deadline: new Date(Date.now() + 120_000).toISOString() } : {}) });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('deposit', dq.depositAddress, dq.amountInFormatted, 'BTC ->', dq.amountOutFormatted, 'USDC');
  const h = await send(w, dq.depositAddress, refund ? Math.max(10_000, depositSats - 3_000) : Number(dq.amountIn)); say('deposit tx', btcExplorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress });
  const st = await poll(dq.depositAddress, 3_000_000); say('final', st.status); summary(st);
} else if (mode === 'near2btc') {
  const acc = await account(); await faucet(acc.accountId, 'intents');
  const before = await balance(me);
  const q = await quote({ originAsset: usdcN.assetId, destinationAsset: btcT.assetId, amount: units(process.env.USDC_IN || '20', usdcN.decimals), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: me });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('depositAddress', dq.depositAddress, dq.amountInFormatted, 'USDC ->', dq.amountOutFormatted, 'BTC to', me);
  const h = await depositIntents(acc, (await api('GET', '/v0/health')).verifier, usdcN.assetId, dq.depositAddress, dq.amountIn); say('near deposit', explorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress }).catch((e: any) => say('submit:', e.message));
  const st = await poll(dq.depositAddress, 900_000); say('final', st.status); summary(st);
  say('recipient mempool/confirmed sats before', before, 'now (confirmed)', await balance(me), '(the payout needs a block to confirm)');
} else throw new Error('mode: reject | faucet | btc2near | near2btc | refund');
