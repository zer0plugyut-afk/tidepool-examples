// LIMIT orders: a SELL below market (fills), and a SELL far above market (cancelled, deposit refunded).
import { api, account, say, units, explorer, ensureVerifierKey, fundViaSignedIntent, faucet, login, sleep, deadlineIn } from './lib.js';
const acc = await account();
const tokens = await api('GET', '/v0/tokens'); const { verifier } = await api('GET', '/v0/health');
const usdc = tokens.find((t: any) => t.symbol === 'USDC'), wnear = tokens.find((t: any) => t.symbol === 'wNEAR');
await faucet(acc.accountId); await ensureVerifierKey(acc, verifier);
const { accessToken } = await login(acc); const H = { authorization: `Bearer ${accessToken}` };
const mk = (price: string) => api('POST', '/v0/orders', { data: { type: 'orders', attributes: { orderType: 'LIMIT', baseAsset: wnear.assetId, quoteAsset: usdc.assetId, quantity: units('0.2', 24), side: 'SELL', price, depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', confidentiality: 'public', deadline: deadlineIn(3600_000) } } }, H);
const wait = async (id: string, want: string[]) => { for (let i = 0; i < 60; i++) { const o = (await api('GET', `/v0/orders/${id}`, undefined, H)).data.attributes; if (want.includes(o.fillStatus)) return o; await sleep(3000); } throw new Error('timeout'); };
const low = (await mk(String((wnear.price * 0.9).toFixed(4)))).data; say('order (fillable)', low.id, low.attributes.fillStatus);
say('funded', explorer((await fundViaSignedIntent(acc, low.attributes.depositAddress, H)).tidepool.txHash));
const f = await wait(low.id, ['FILLED']); say('FILLED', JSON.stringify(f.partialFills), 'payout', explorer(f.payouts.withdrawal.txHash));
const high = (await mk(String((wnear.price * 10).toFixed(4)))).data; say('order (far above market)', high.id);
await fundViaSignedIntent(acc, high.attributes.depositAddress, H); await wait(high.id, ['OPEN']);
say('cancel ->', (await api('POST', `/v0/orders/${high.id}/cancel`, {}, H)).data.attributes.fillStatus);
const c = await wait(high.id, ['CANCELED']); say('CANCELED; refund', explorer(c.payouts.refund.txHash));
say('list', (await api('GET', '/v0/orders?page[size]=5', undefined, H)).data.map((o: any) => `${o.id}:${o.attributes.fillStatus}`).join(' '));
