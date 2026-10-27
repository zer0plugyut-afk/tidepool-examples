// Signed-intent flow: quote (INTENTS) -> /v0/generate-intent -> sign NEP-413 -> /v0/submit-intent -> poll.
import { api, account, poll, say, units, explorer, ensureVerifierKey, fundViaSignedIntent, faucet, deadlineIn } from './lib.js';
const acc = await account();
const tokens = await api('GET', '/v0/tokens'); const { verifier } = await api('GET', '/v0/health');
const usdc = tokens.find((t: any) => t.symbol === 'USDC'), wnear = tokens.find((t: any) => t.symbol === 'wNEAR');
await faucet(acc.accountId); await ensureVerifierKey(acc, verifier);
const q = await api('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: usdc.assetId, destinationAsset: wnear.assetId, amount: units('1', 6), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', deadline: deadlineIn(600_000) });
say('quote', q.quote.depositAddress);
const sub = await fundViaSignedIntent(acc, q.quote.depositAddress);
say('submit-intent', JSON.stringify({ intentHash: sub.intentHash, correlationId: sub.correlationId }), explorer(sub.tidepool.txHash));
const st = await poll(q.quote.depositAddress);
for (const h of st.swapDetails.nearTxHashes || []) say('explorer', explorer(h));
process.exit(st.status === 'SUCCESS' ? 0 : 1);
