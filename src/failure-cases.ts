// Failure cases: partial deposit (refund), expired quote (refund after deadline), and API validation errors.
//   npm run failure-cases            all cases
//   npm run failure-cases partial    | expired | errors
import crypto from 'node:crypto';
import { api, call, account, depositIntents, poll, say, sleep, explorer } from './lib.js';

const CASE = process.argv[2] || 'all';
const acc = await account();
const tokens = await api('GET', '/v0/tokens');
const USDC = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near'), WNEAR = tokens.find((t: any) => t.symbol === 'wNEAR' && t.blockchain === 'near');
const { verifier } = await api('GET', '/v0/health');
try { await api('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents' }); say('faucet ok'); } catch (e: any) { say('faucet skipped:', e.message); }
const body = (deadlineMs: number) => ({
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: USDC.assetId, destinationAsset: WNEAR.assetId, amount: '2000000',
  depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS',
  deadline: new Date(Date.now() + deadlineMs).toISOString(),
});
const report = (name: string, st: any) => { const d = st.swapDetails; say(`[${name}] ${st.status}`, JSON.stringify({ refundReason: d.refundReason, refunded: d.refundedAmountFormatted })); for (const h of d.nearTxHashes || []) say('  ', explorer(h)); };

const cases: Record<string, () => Promise<void>> = {
  // Deposit half of amountIn: INCOMPLETE_DEPOSIT, then REFUNDED once the deadline passes.
  async partial() {
    const q = await api('POST', '/v0/quote', body(75_000));
    const tx = await depositIntents(acc, verifier, USDC.assetId, q.quote.depositAddress, (BigInt(q.quote.amountIn) / 2n).toString());
    say('[partial] deposited half', explorer(tx));
    report('partial', await poll(q.quote.depositAddress));
  },
  // Let a 65 s quote expire, then deposit the full amount: REFUNDED.
  async expired() {
    const q = await api('POST', '/v0/quote', body(65_000));
    say('[expired] waiting for deadline', q.quote.deadline);
    await sleep(new Date(q.quote.deadline).getTime() - Date.now() + 5_000);
    const tx = await depositIntents(acc, verifier, USDC.assetId, q.quote.depositAddress, q.quote.amountIn);
    say('[expired] deposited after deadline', explorer(tx));
    report('expired', await poll(q.quote.depositAddress));
  },
  // Errors you should handle before any funds move.
  async errors() {
    const show = async (label: string, p: Promise<any>) => { const r = await p; say(`[errors] ${label}: HTTP ${r.status}`, JSON.stringify(r.body)); };
    await show('deadline 30 s ahead', call('POST', '/v0/quote', body(30_000)));
    await show('unsupported depositMode MEMO', call('POST', '/v0/quote', { ...body(600_000), depositMode: 'MEMO' }));
    await show('unknown deposit address', call('GET', `/v0/status?depositAddress=${crypto.randomBytes(32).toString('hex')}`));
  },
};
for (const c of CASE === 'all' ? ['errors', 'partial', 'expired'] : [CASE]) await cases[c]();
