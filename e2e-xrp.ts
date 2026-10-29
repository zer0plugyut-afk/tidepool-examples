// Testnet e2e for the Tidepool XRP Ledger bridge. Modes: reject | faucet | xrp2near | near2xrp | refund. Never prints keys.
//   TIDEPOOL_URL=https://www.usetidepool.tech npx tsx e2e-xrp.ts xrp2near
// The payer is a throwaway testnet wallet kept in /tmp/xrp-payer.json (or XRP_SEED), funded from the official XRPL testnet faucet.
import fs from 'node:fs';
import { newWallet, walletOf, balance, fund, pay, xrpExplorer } from './src/xrp-lib.js';
import { api, call, account, depositIntents, poll, say, units, explorer, faucet } from './src/lib.js';

const mode = process.argv[2];
const keyFile = '/tmp/xrp-payer.json';
const payer = process.env.XRP_SEED ? walletOf(process.env.XRP_SEED) : fs.existsSync(keyFile) ? walletOf(JSON.parse(fs.readFileSync(keyFile, 'utf8')).seed) : (() => { const w = newWallet(); fs.writeFileSync(keyFile, JSON.stringify({ seed: w.seed }), { mode: 0o600 }); return w; })();
const me = payer.classicAddress;
async function ensureFunds() { if ((await balance(me)) < 30_000_000n) { say('funding', me, 'from the official XRPL testnet faucet'); await fund(me); } say('payer', me, 'drops', String(await balance(me))); }

const tokens = await api('GET', '/v0/tokens');
const xrp = tokens.find((t: any) => t.symbol === 'XRP' && t.blockchain === 'xrp'), usdcN = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!xrp) throw new Error('XRP not listed');
const quote = (o: any) => call('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 1800_000).toISOString(), ...o });
const summary = (st: any) => console.log(JSON.stringify({ status: st.status, near: st.swapDetails?.nearTxHashes, origin: st.swapDetails?.originChainTxHashes, dest: st.swapDetails?.destinationChainTxHashes, refunded: st.swapDetails?.refundedAmountFormatted, in: st.swapDetails?.amountInFormatted, out: st.swapDetails?.amountOutFormatted }, null, 1));

if (mode === 'reject') {
  await ensureFunds();
  const over = await quote({ originAsset: xrp.assetId, destinationAsset: usdcN.assetId, amount: units('100.000001', 6), depositMode: 'MEMO', refundTo: me, recipient: 'alice.tidepool-sandbox.testnet' });
  say('quote 100.000001 XRP in ->', over.status, over.body?.message); if (over.status !== 400) process.exit(1);
  const acc = await account();
  const over2 = await quote({ originAsset: usdcN.assetId, destinationAsset: xrp.assetId, amount: units('100000', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: me });
  say('quote huge USDC -> >100 XRP out ->', over2.status, over2.body?.message); if (over2.status !== 400) process.exit(1);
  const nomemo = await quote({ originAsset: xrp.assetId, destinationAsset: usdcN.assetId, amount: units('1', 6), refundTo: me, recipient: 'alice.tidepool-sandbox.testnet' });
  say('quote without depositMode MEMO ->', nomemo.status, nomemo.body?.message); if (nomemo.status !== 400) process.exit(1);
  const bad = await quote({ originAsset: usdcN.assetId, destinationAsset: xrp.assetId, amount: units('1', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: '0x38d81431B9f76d9699AF7517040D5221D9dEA252' });
  say('quote with an EVM address as XRP recipient ->', bad.status, bad.body?.message); if (bad.status !== 400) process.exit(1);
} else if (mode === 'faucet') {
  const f = await call('POST', '/v0/faucet', { chain: 'xrp', address: me });
  say('chain xrp faucet ->', f.status, f.body?.message); if (f.status !== 400) process.exit(1);
  const acc = await account();
  const i = await call('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents', assets: ['xrp'] });
  say('intents alias xrp ->', i.status, i.body?.message); if (i.status !== 400) process.exit(1);
} else if (mode === 'xrp2near' || mode === 'refund') {
  await ensureFunds();
  const acc = await account(); const refund = mode === 'refund';
  const q = await quote({ originAsset: xrp.assetId, destinationAsset: usdcN.assetId, amount: units(refund ? '10' : '5', 6), depositMode: 'MEMO', refundTo: me, recipient: acc.accountId, ...(refund ? { deadline: new Date(Date.now() + 90_000).toISOString() } : {}) });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('deposit', dq.depositAddress, 'tag', dq.depositMemo, dq.amountInFormatted, 'XRP ->', dq.amountOutFormatted, 'USDC');
  const h = await pay(payer, dq.depositAddress, refund ? units('4', 6) : dq.amountIn, dq.depositMemo); say('deposit tx', xrpExplorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress, memo: dq.depositMemo });
  const st = await poll(dq.depositAddress, 900_000, undefined, dq.depositMemo); say('final', st.status); summary(st);
} else if (mode === 'near2xrp') {
  await ensureFunds();
  const acc = await account(); await faucet(acc.accountId, 'intents');
  const before = await balance(me);
  const q = await quote({ originAsset: usdcN.assetId, destinationAsset: xrp.assetId, amount: units(process.env.USDC_IN || '5', usdcN.decimals), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: me });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('depositAddress', dq.depositAddress, dq.amountInFormatted, 'USDC ->', dq.amountOutFormatted, 'XRP to', me);
  const h = await depositIntents(acc, (await api('GET', '/v0/health')).verifier, usdcN.assetId, dq.depositAddress, dq.amountIn); say('near deposit', explorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress }).catch((e: any) => say('submit:', e.message));
  const st = await poll(dq.depositAddress, 900_000); say('final', st.status); summary(st);
  say('recipient drops before', String(before), 'now', String(await balance(me)));
} else throw new Error('mode: reject | faucet | xrp2near | near2xrp | refund');
