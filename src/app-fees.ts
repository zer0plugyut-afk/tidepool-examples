// appFees: 1% of the input goes to a fee recipient in the same execute_intents call.
import crypto from 'node:crypto';
import { api, account, poll, say, units, explorer, ensureVerifierKey, fundViaSignedIntent, faucet, deadlineIn, verifierBalance } from './lib.js';
const acc = await account();
const tokens = await api('GET', '/v0/tokens'); const { verifier } = await api('GET', '/v0/health');
const usdc = tokens.find((t: any) => t.symbol === 'USDC'), usdt = tokens.find((t: any) => t.symbol === 'USDT');
await faucet(acc.accountId); await ensureVerifierKey(acc, verifier);
const feeTo = process.env.FEE_RECIPIENT || crypto.randomBytes(32).toString('hex'); // any Intents account; implicit by default
const base = { swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: usdc.assetId, destinationAsset: usdt.assetId, amount: units('2', 6), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', deadline: deadlineIn(600_000) };
const plain = await api('POST', '/v0/quote', { ...base, dry: true });
const q = await api('POST', '/v0/quote', { ...base, dry: false, appFees: [{ recipient: feeTo, fee: 100 }] });
say(`amountOut without fee ${plain.quote.amountOutFormatted}, with 100 bps appFee ${q.quote.amountOutFormatted}`);
const before = BigInt(await verifierBalance(acc, verifier, feeTo, usdc.assetId));
await fundViaSignedIntent(acc, q.quote.depositAddress);
const st = await poll(q.quote.depositAddress);
const after = BigInt(await verifierBalance(acc, verifier, feeTo, usdc.assetId));
say('fee recipient', feeTo, 'received', (after - before).toString(), 'USDC units (expected', (BigInt(base.amount) / 100n).toString() + ')');
say('status.tidepool.appFees', JSON.stringify(st.tidepool?.appFees));
for (const h of st.swapDetails.nearTxHashes || []) say('explorer', explorer(h));
process.exit(st.status === 'SUCCESS' && after - before === BigInt(base.amount) / 100n ? 0 : 1);
