// Testnet e2e for the Tidepool Sui bridge. Modes: reject | sui2near | refund | near2sui | near2usdc | faucet. Never prints keys.
//   TIDEPOOL_URL=https://www.usetidepool.tech npx tsx e2e-sui.ts sui2near
// The payer is a throwaway testnet key kept in /tmp/sui-payer.json (or SUI_SECRET_KEY). It needs a little testnet SUI: fund it at
// https://faucet.sui.io, or set SUI_FUNDER_KEY (a testnet key holding SUI) and the script tops the payer up to 2 SUI itself.
import fs from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { run, coinSum, suiscan as sx } from './src/sui-lib.js';
import { api, call, account, depositIntents, poll, say, units, explorer, faucet } from './src/lib.js';

const mode = process.argv[2];
const keyFile = '/tmp/sui-payer.json';
const payer = process.env.SUI_SECRET_KEY ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUI_SECRET_KEY).secretKey)
  : fs.existsSync(keyFile) ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(JSON.parse(fs.readFileSync(keyFile, 'utf8')).secret).secretKey)
  : (() => { const k = Ed25519Keypair.generate(); fs.writeFileSync(keyFile, JSON.stringify({ secret: k.getSecretKey() }), { mode: 0o600 }); return k; })();
const me = payer.toSuiAddress();

async function fund() {
  if ((await coinSum(me, '0x2::sui::SUI')) >= 1_000_000_000n) return;
  if (!process.env.SUI_FUNDER_KEY) throw new Error(`payer ${me} needs testnet SUI: https://faucet.sui.io (or set SUI_FUNDER_KEY)`);
  const f = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUI_FUNDER_KEY).secretKey);
  say('top-up tx', sx(await run(f, tx => { const [c] = tx.splitCoins(tx.gas, [2_000_000_000n]); tx.transferObjects([c], me); })));
}
const tokens = await api('GET', '/v0/tokens');
const suiT = tokens.find((t: any) => t.symbol === 'SUI' && t.blockchain === 'sui'), usdcN = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near'), usdcS = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'sui');
if (!suiT) throw new Error('Sui not listed');
const quote = (o: any) => call('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN', deadline: new Date(Date.now() + 1800_000).toISOString(), ...o });
const summary = (st: any) => console.log(JSON.stringify({ status: st.status, near: st.swapDetails?.nearTxHashes, origin: st.swapDetails?.originChainTxHashes, dest: st.swapDetails?.destinationChainTxHashes, refunded: st.swapDetails?.refundedAmountFormatted, in: st.swapDetails?.amountInFormatted, out: st.swapDetails?.amountOutFormatted, explorer: st.tidepool?.explorer }, null, 1));

if (mode === 'reject') {
  const over = await quote({ originAsset: suiT.assetId, destinationAsset: usdcN.assetId, amount: units('10.000000001', 9), refundTo: me, recipient: 'alice.tidepool-sandbox.testnet' });
  say('quote 10.000000001 SUI in ->', over.status, over.body?.message); if (over.status !== 400) process.exit(1);
  const acc = await account();
  const over2 = await quote({ originAsset: usdcN.assetId, destinationAsset: suiT.assetId, amount: units('1000', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: me });
  say('quote ~1000 USDC -> >10 SUI out ->', over2.status, over2.body?.message); if (over2.status !== 400) process.exit(1);
  const bad = await quote({ originAsset: usdcN.assetId, destinationAsset: suiT.assetId, amount: units('1', usdcN.decimals), depositType: 'INTENTS', refundType: 'INTENTS', refundTo: acc.accountId, recipient: 'not-a-sui-address' });
  say('quote with a malformed Sui recipient ->', bad.status, bad.body?.message); if (bad.status !== 400) process.exit(1);
} else if (mode === 'sui2near' || mode === 'refund') {
  await fund();
  const acc = await account(); const refund = mode === 'refund';
  const q = await quote({ originAsset: suiT.assetId, destinationAsset: usdcN.assetId, amount: units(refund ? '1' : '0.5', 9), refundTo: me, recipient: acc.accountId, ...(refund ? { deadline: new Date(Date.now() + 90_000).toISOString() } : {}) });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('deposit', dq.depositAddress, dq.amountInFormatted, 'SUI ->', dq.amountOutFormatted, 'USDC');
  const h = await run(payer, tx => { const [c] = tx.splitCoins(tx.gas, [BigInt(refund ? units('0.4', 9) : dq.amountIn)]); tx.transferObjects([c], dq.depositAddress); }); say('deposit tx', sx(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress });
  const st = await poll(dq.depositAddress, 900_000); say('final', st.status); summary(st);
} else if (mode === 'near2sui' || mode === 'near2usdc') {
  await fund();
  const acc = await account(); await faucet(acc.accountId, 'intents');
  const out = mode === 'near2sui' ? suiT : usdcS;
  const before = await coinSum(me, out.contractAddress || '0x2::sui::SUI');
  const q = await quote({ originAsset: usdcN.assetId, destinationAsset: out.assetId, amount: units('5', usdcN.decimals), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: me });
  if (q.status >= 400) throw new Error('quote ' + q.status + ' ' + q.body?.message);
  const dq = q.body.quote; say('depositAddress', dq.depositAddress, dq.amountInFormatted, 'USDC ->', dq.amountOutFormatted, out.symbol, 'to', me);
  const h = await depositIntents(acc, (await api('GET', '/v0/health')).verifier, usdcN.assetId, dq.depositAddress, dq.amountIn); say('near deposit', explorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: dq.depositAddress }).catch((e: any) => say('submit:', e.message));
  const st = await poll(dq.depositAddress, 900_000); say('final', st.status); summary(st);
  const after = await coinSum(me, out.contractAddress || '0x2::sui::SUI'); say('recipient', out.symbol, 'balance change', String(after - before));
} else if (mode === 'faucet') {
  const direct = await call('POST', '/v0/faucet', { chain: 'sui', address: me });
  say('direct-chain drip (USDC+USDT to a Sui wallet) ->', direct.status, JSON.stringify(direct.body?.transactions ?? direct.body?.message), direct.body?.drips?.map((d: any) => `${d.amount} ${d.symbol}`).join(', '));
  if (direct.status !== 200) process.exit(1);
  say('wallet USDC base units', String(await coinSum(me, usdcS.contractAddress)));
  const acc = await account();
  const intents = await call('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents', assets: ['sui'] });
  say('intents drip (alias "sui") ->', intents.status, JSON.stringify(intents.body?.transactions ?? intents.body?.message), JSON.stringify(intents.body?.drips?.map((d: any) => `${d.amount} ${d.symbol}`)));
  if (intents.status !== 200) process.exit(1);
}
