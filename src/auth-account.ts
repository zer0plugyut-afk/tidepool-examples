// /v0/auth/authenticate (NEP-413 signature) -> /v0/auth/refresh -> /v0/account/balances + /v0/account/history
import { account, say, login, call } from './lib.js';
const acc = await account();
const t = await login(acc); say('authenticated; expiresIn', t.expiresIn, 'refreshExpiresIn', t.refreshExpiresIn);
const auth = { authorization: `Bearer ${t.accessToken}` };
const r = await call('POST', '/v0/auth/refresh', { refreshToken: t.refreshToken }); say('refresh', r.status, 'expiresIn', r.body.expiresIn);
const b = await call('GET', '/v0/account/balances', undefined, auth); say('balances', b.status, JSON.stringify(b.body.balances));
const h = await call('GET', '/v0/account/history?limit=5', undefined, auth); say('history', h.status, h.body.items?.length, 'items; latest', h.body.items?.[0]?.status, h.body.items?.[0]?.depositAddress);
const no = await call('GET', '/v0/account/balances', undefined, { authorization: 'Bearer nope' }); say('bad token ->', no.status);
process.exit(r.status === 200 && b.status === 200 && h.status === 200 && no.status === 401 ? 0 : 1);
