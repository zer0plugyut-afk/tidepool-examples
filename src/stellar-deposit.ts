// Cross-chain: deposit Stellar testnet XLM (MEMO deposit mode), receive NEAR testnet USDC.
// Stellar has no per-quote deposit addresses: every quote shares ONE depositAddress and is told apart by a numeric depositMemo,
// so the quote needs depositMode "MEMO" and your payment must carry that memo (like on 1Click).
//   RECIPIENT=you.testnet npm run stellar-deposit                       (generates a throwaway keypair and funds it with Friendbot)
//   STELLAR_SECRET=S... RECIPIENT=you.testnet npm run stellar-deposit   (use your own TESTNET key; never one that holds real funds)
// AMOUNT (XLM, default 5). XLM is capped at 100 XLM per swap on Tidepool's Stellar testnet bridge. HORIZON overrides the public testnet Horizon.
import { Keypair, TransactionBuilder, Operation, Asset, Networks, Account, Memo, BASE_FEE } from '@stellar/stellar-base';
import { api, poll, say, units } from './lib.js';

const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const AMOUNT = process.env.AMOUNT || '5';
const HORIZON = (process.env.HORIZON || 'https://horizon-testnet.stellar.org').replace(/\/$/, '');
const kp = process.env.STELLAR_SECRET ? Keypair.fromSecret(process.env.STELLAR_SECRET) : Keypair.random();
const hz = async (path: string, init?: RequestInit) => { const r = await fetch(HORIZON + path, init); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };

let acct = await hz(`/accounts/${kp.publicKey()}`);
if (acct.status === 404) { // Friendbot: 10,000 test XLM
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`); if (!fb.ok) throw new Error('friendbot failed ' + fb.status);
  acct = await hz(`/accounts/${kp.publicKey()}`);
}
say('Stellar', kp.publicKey(), 'XLM balance', acct.body.balances.find((b: any) => b.asset_type === 'native').balance);

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'XLM' && t.blockchain === 'stellar'), tOut = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!tIn) throw new Error('this Tidepool server has no Stellar testnet bridge');
say('asset', tIn.assetId);

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'ORIGIN_CHAIN', depositMode: 'MEMO', refundTo: kp.publicKey(), refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 1800_000).toISOString(),
});
const { depositAddress, depositMemo } = q.quote;
say('deposit to', depositAddress, 'memo', depositMemo, '|', q.quote.amountInFormatted, 'XLM ->', q.quote.amountOutFormatted, 'USDC');

const seq = acct.body.sequence;
const tx = new TransactionBuilder(new Account(kp.publicKey(), seq), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: depositAddress, asset: Asset.native(), amount: (Number(q.quote.amountIn) / 1e7).toFixed(7) }))
  .addMemo(Memo.text(depositMemo)).setTimeout(120).build();
tx.sign(kp);
const sent = await hz('/transactions', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ tx: tx.toEnvelope().toXDR('base64') }) });
if (sent.status >= 300) throw new Error('payment failed: ' + JSON.stringify(sent.body?.extras?.result_codes ?? sent.body));
say('deposit tx', `https://stellar.expert/explorer/testnet/tx/${sent.body.hash}`);
// Optional: the worker detects the payment on its own; submitting the hash just speeds up the status change.
await api('POST', '/v0/deposit/submit', { txHash: sent.body.hash, depositAddress, memo: depositMemo });
const st = await poll(depositAddress, 900_000, undefined, depositMemo);
say('result', st.status, JSON.stringify(st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);
