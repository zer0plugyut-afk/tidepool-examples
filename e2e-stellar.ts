// Testnet e2e for the Tidepool Stellar bridge. Modes: reject | xlm2near | refund | near2xlm | near2usdc. Never prints keys.
//   TIDEPOOL_URL=https://www.usetidepool.tech npx tsx e2e-stellar.ts xlm2near
import fs from 'node:fs';
import { Keypair, TransactionBuilder, Operation, Asset, Networks, Account, Memo, BASE_FEE } from '@stellar/stellar-base';
import { api, call, account, depositIntents, poll, say, units, explorer, faucet } from './src/lib.js';

const mode = process.argv[2];
const HZ = 'https://horizon-testnet.stellar.org';
const sx = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
const hz = async (path: string, init?: RequestInit) => { const r = await fetch(HZ + path, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
const payerFile = '/tmp/stellar-payer.json';
const payer = fs.existsSync(payerFile) ? Keypair.fromSecret(JSON.parse(fs.readFileSync(payerFile, 'utf8')).secret) : (() => { const k = Keypair.random(); fs.writeFileSync(payerFile, JSON.stringify({ secret: k.secret() }), { mode: 0o600 }); return k; })();
async function fund() {
  if ((await hz(`/accounts/${payer.publicKey()}`)).status === 200) return;
  const f = await fetch(`https://friendbot.stellar.org/?addr=${payer.publicKey()}`); if (!f.ok) throw new Error('friendbot ' + f.status);
}
async function pay(to: string, stroops: string, memo: string) {
  const a = await hz(`/accounts/${payer.publicKey()}`);
  const tx = new TransactionBuilder(new Account(payer.publicKey(), a.body.sequence), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.payment({ destination: to, asset: Asset.native(), amount: (Number(stroops) / 1e7).toFixed(7) })).addMemo(Memo.text(memo)).setTimeout(120).build();
  tx.sign(payer);
  const r = await hz('/transactions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: tx.toEnvelope().toXDR('base64') }) });
  if (r.status >= 300) throw new Error('payment failed ' + JSON.stringify(r.body?.extras?.result_codes ?? r.body));
  return r.body.hash as string;
}
const tokens = await api('GET', '/v0/tokens');
const xlm = tokens.find((t: any) => t.symbol === 'XLM' && t.blockchain === 'stellar'), usdcN = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near'), usdcS = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'stellar');
if (!xlm) throw new Error('Stellar not listed');
const quote = (o: any) => call('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 1800_000).toISOString(), ...o });
const summary = (st: any) => console.log(JSON.stringify({ status: st.status, near: st.swapDetails?.nearTxHashes, origin: st.swapDetails?.originChainTxHashes, dest: st.swapDetails?.destinationChainTxHashes, refunded: st.swapDetails?.refundedAmountFormatted }, null, 1));

if (mode === 'reject') {
  await fund();
  const over = await quote({ originAsset: xlm.assetId, destinationAsset: usdcN.assetId, amount: units('100.0000001', 7), depositMode: 'MEMO', refundTo: payer.publicKey(), recipient: 'alice.tidepool-sandbox.testnet' });
  say('quote 100.0000001 XLM in ->', over.status, over.body?.message); if (over.status !== 400) process.exit(1);
  const acc = await account();
  const over2 = await quote({ originAsset: usdcN.assetId, destinationAsset: xlm.assetId, amount: units('1000', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: payer.publicKey() });
  say('quote ~1000 USDC -> >100 XLM out ->', over2.status, over2.body?.message); if (over2.status !== 400) process.exit(1);
  const nomemo = await quote({ originAsset: xlm.assetId, destinationAsset: usdcN.assetId, amount: units('1', 7), refundTo: payer.publicKey(), recipient: 'alice.tidepool-sandbox.testnet' });
  say('quote without depositMode MEMO ->', nomemo.status, nomemo.body?.message); if (nomemo.status !== 400) process.exit(1);
} else if (mode === 'xlm2near' || mode === 'refund') {
  await fund();
  const acc = await account(); const refund = mode === 'refund';
  const q = await quote({ originAsset: xlm.assetId, destinationAsset: usdcN.assetId, amount: units(refund ? '10' : '5', 7), depositMode: 'MEMO', refundTo: payer.publicKey(), recipient: acc.accountId, ...(refund ? { deadline: new Date(Date.now() + 90_000).toISOString() } : {}) });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('deposit', dq.depositAddress, 'memo', dq.depositMemo, dq.amountInFormatted, 'XLM ->', dq.amountOutFormatted, 'USDC');
  const h = await pay(dq.depositAddress, refund ? units('4', 7) : dq.amountIn, dq.depositMemo); say('deposit tx', sx(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress, memo: dq.depositMemo });
  const st = await poll(dq.depositAddress, 900_000, undefined, dq.depositMemo); say('final', st.status); summary(st);
} else if (mode === 'near2xlm' || mode === 'near2usdc') {
  await fund();
  const acc = await account(); await faucet(acc.accountId, 'intents');
  const out = mode === 'near2xlm' ? xlm : usdcS;
  if (mode === 'near2usdc') { // the recipient needs a trustline: add it once with changeTrust
    const a = await hz(`/accounts/${payer.publicKey()}`);
    if (!a.body.balances.some((b: any) => b.asset_code === 'USDC' && b.asset_issuer === usdcS.contractAddress)) {
      const tx = new TransactionBuilder(new Account(payer.publicKey(), a.body.sequence), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET }).addOperation(Operation.changeTrust({ asset: new Asset('USDC', usdcS.contractAddress) })).setTimeout(120).build();
      tx.sign(payer); const r = await hz('/transactions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: tx.toEnvelope().toXDR('base64') }) });
      say('trustline tx', sx(r.body.hash));
    }
  }
  const q = await quote({ originAsset: usdcN.assetId, destinationAsset: out.assetId, amount: units('5', usdcN.decimals), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: payer.publicKey() });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('depositAddress', dq.depositAddress, dq.amountInFormatted, 'USDC ->', dq.amountOutFormatted, out.symbol, 'to', payer.publicKey());
  const h = await depositIntents(acc, (await api('GET', '/v0/health')).verifier, usdcN.assetId, dq.depositAddress, dq.amountIn); say('near deposit', explorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress }).catch((e: any) => say('submit:', e.message));
  const st = await poll(dq.depositAddress, 900_000); say('final', st.status); summary(st);
  const a = await hz(`/accounts/${payer.publicKey()}`); say('recipient balances', JSON.stringify(a.body.balances.map((b: any) => `${b.asset_code || 'XLM'}=${b.balance}`)));
}
