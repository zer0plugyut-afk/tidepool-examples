// ANY_INPUT: one deposit address, any number of deposits of any size, each converted at the live price.
import { api, account, say, units, explorer, ensureVerifierKey, depositIntents, faucet, deadlineIn, sleep } from './lib.js';
const acc = await account();
const tokens = await api('GET', '/v0/tokens'); const { verifier } = await api('GET', '/v0/health');
const usdc = tokens.find((t: any) => t.symbol === 'USDC'), wnear = tokens.find((t: any) => t.symbol === 'wNEAR');
await faucet(acc.accountId); await ensureVerifierKey(acc, verifier);
const q = await api('POST', '/v0/quote', { dry: false, swapType: 'ANY_INPUT', slippageTolerance: 100, originAsset: usdc.assetId, destinationAsset: wnear.assetId, amount: units('1', 6), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', deadline: deadlineIn(900_000) });
const addr = q.quote.depositAddress; say('ANY_INPUT deposit address', addr, 'minAmountIn', q.quote.minAmountIn);
const w = () => api('GET', `/v0/any-input/withdrawals?depositAddress=${addr}&sortOrder=asc`);
for (const [i, amt] of ['0.5', '1.25'].entries()) {
  const tx = await depositIntents(acc, verifier, usdc.assetId, addr, units(amt, 6)); say(`deposit ${i + 1}: ${amt} USDC`, explorer(tx));
  for (let t = 0; t < 40 && (await w()).tidepool.withdrawals.length <= i; t++) await sleep(3000);
}
const res = await w();
// spec: `withdrawals` is one AnyInputQuoteWithdrawal; Tidepool lists the whole page in tidepool.withdrawals
for (const x of res.tidepool.withdrawals) say('withdrawal', x.status, x.amountOutFormatted, 'wNEAR', explorer(x.hash));
process.exit(res.tidepool.withdrawals.length === 2 && res.tidepool.withdrawals.every((x: any) => x.status === 'SUCCESS') ? 0 : 1);
