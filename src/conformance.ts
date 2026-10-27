// Live conformance check: Tidepool vs the official 1Click OpenAPI spec.
// Runs real calls (tokens, dry + live quote, deposit, submit, status polling, health, openapi.json) and compares
// HTTP status codes and required fields with the spec's success responses. Writes conformance-result.json + a Markdown table.
//   npm run conformance
import fs from 'node:fs';
import { parse } from 'yaml';
import { api, call, account, depositIntents, poll, say, API, signNep413, login, ensureVerifierKey, sleep } from './lib.js';

const SPEC_URL = 'https://1click.chaindefuser.com/docs/v0/openapi.yaml';
const spec = parse(await (await fetch(SPEC_URL)).text());
const S = spec.components.schemas;
const ref = (x: any): any => (x?.$ref ? S[x.$ref.split('/').pop()] : x);
// Recursively list missing required fields (and type mismatches for primitives) for a value against a schema.
function check(schema: any, v: any, path = ''): string[] {
  schema = ref(schema); if (!schema) return [];
  if (v === null && schema.nullable) return [];
  if (schema.oneOf) { const opts = schema.oneOf.map((o: any) => check(o, v, path)); return opts.find((x: string[]) => !x.length) ?? opts[0]; }
  if (schema.allOf) return schema.allOf.flatMap((s: any) => check(s, v, path));
  if (schema.type === 'array' || schema.items) return Array.isArray(v) ? v.slice(0, 3).flatMap((x, i) => check(schema.items, x, `${path}[${i}]`)) : [`${path}: expected array`];
  if (schema.enum && v !== undefined && !schema.enum.includes(v)) return [`${path}: ${JSON.stringify(v)} not in enum`];
  if (schema.type === 'string' && v !== undefined && v !== null && typeof v !== 'string') return [`${path}: expected string, got ${typeof v}`];
  if (schema.type === 'number' && v !== undefined && v !== null && typeof v !== 'number') return [`${path}: expected number, got ${typeof v}`];
  if (!schema.properties) return [];
  const out: string[] = [];
  for (const k of schema.required || []) if (v?.[k] === undefined) out.push(`${path}.${k}: missing`);
  for (const [k, s] of Object.entries(schema.properties)) if (v?.[k] !== undefined) out.push(...check(s, v[k], `${path}.${k}`));
  return out;
}
const okCodes = (p: string, m: string) => Object.keys(spec.paths[p][m].responses).filter(c => c.startsWith('2'));
const schemaFor = (p: string, m: string) => spec.paths[p][m].responses[okCodes(p, m)[0]]?.content?.['application/json']?.schema;
const rows: any[] = [];
const rec = (name: string, p: string | null, m: string, r: { status: number; body: any }, expectStatus?: number) => {
  const want = p ? okCodes(p, m).map(Number) : [expectStatus ?? 200];
  const issues = [...(want.includes(r.status) ? [] : [`HTTP ${r.status}, spec says ${want.join('/')}`]), ...(p && r.status < 300 ? check(schemaFor(p, m), r.body) : [])];
  rows.push({ name, endpoint: `${m.toUpperCase()} ${p ?? ''}`.trim(), http: r.status, specHttp: want.join('/'), pass: issues.length === 0, issues });
  say(issues.length ? 'FAIL' : 'PASS', name, r.status, issues.slice(0, 5).join('; '));
  return r.body;
};

say('API', API, 'spec', SPEC_URL, spec.info?.version);
const tokens = rec('tokens', '/v0/tokens', 'get', await call('GET', '/v0/tokens'));
const health = rec('health (Tidepool extension)', null, 'get', await call('GET', '/v0/health'));
rows.at(-1).endpoint = 'GET /v0/health';
const oa = await fetch(API + '/openapi.json'); const oaj = await oa.json().catch(() => null);
rows.push({ name: 'openapi.json reachable', endpoint: 'GET /openapi.json', http: oa.status, specHttp: '200', pass: oa.status === 200 && !!oaj?.paths, issues: oaj?.paths ? [] : ['not JSON OpenAPI'] });

const acc = await account();
const USDC = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near'), WNEAR = tokens.find((t: any) => t.symbol === 'wNEAR' && t.blockchain === 'near');
try { await api('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents' }); } catch (e: any) { say('faucet skipped:', e.message); }
const req = { swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: USDC.assetId, destinationAsset: WNEAR.assetId, amount: '1000000', depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', deadline: new Date(Date.now() + 600_000).toISOString() };
rec('quote (dry)', '/v0/quote', 'post', await call('POST', '/v0/quote', { ...req, dry: true }));
const live = rec('quote (live)', '/v0/quote', 'post', await call('POST', '/v0/quote', { ...req, dry: false }));
for (const k of ['depositAddress', 'deadline', 'timeWhenInactive']) if (!live.quote[k]) { rows.at(-1).pass = false; rows.at(-1).issues.push(`quote.${k}: missing on live quote`); }
const dep = live.quote.depositAddress;
rec('status (before deposit)', '/v0/status', 'get', await call('GET', `/v0/status?depositAddress=${dep}`));
const txHash = await depositIntents(acc, health.verifier, USDC.assetId, dep, live.quote.amountIn);
rec('deposit/submit', '/v0/deposit/submit', 'post', await call('POST', '/v0/deposit/submit', { txHash, depositAddress: dep, nearSenderAccount: acc.accountId }));
const seen: string[] = [];
const fin = await poll(dep, 300_000, st => seen.push(st.status));
rec(`status polling (${seen.join(' → ')})`, '/v0/status', 'get', { status: 200, body: fin });
if (fin.status !== 'SUCCESS') { rows.at(-1).pass = false; rows.at(-1).issues.push(`final status ${fin.status}`); }
rec('status unknown address → 404', null, 'get', await call('GET', '/v0/status?depositAddress=nope'), 404); rows.at(-1).endpoint = 'GET /v0/status';
rec('quote bad input → 400', null, 'post', await call('POST', '/v0/quote', { ...req, dry: true, amount: 'x' }), 400); rows.at(-1).endpoint = 'POST /v0/quote';

// ---- signed-intent flow, appFees, ANY_INPUT, auth/account, orders, MEMO ----
await ensureVerifierKey(acc, health.verifier);
const live2 = await api('POST', '/v0/quote', { ...req, dry: false, appFees: [{ recipient: acc.accountId, fee: 50 }] });
rec('quote with appFees', '/v0/quote', 'post', { status: 200, body: live2 });
const gen = rec('generate-intent (nep413)', '/v0/generate-intent', 'post', await call('POST', '/v0/generate-intent', { type: 'swap_transfer', standard: 'nep413', signerId: acc.accountId, depositAddress: live2.quote.depositAddress }));
const sub = rec('submit-intent', '/v0/submit-intent', 'post', await call('POST', '/v0/submit-intent', { type: 'swap_transfer', signedData: await signNep413(acc, gen.intent.payload) }));
const fin2 = await poll(live2.quote.depositAddress);
rec('signed-intent swap → SUCCESS', '/v0/status', 'get', { status: 200, body: fin2 }); if (fin2.status !== 'SUCCESS') { rows.at(-1).pass = false; rows.at(-1).issues.push(`final ${fin2.status}`); }
rec('generate-intent bad standard → 400', null, 'post', await call('POST', '/v0/generate-intent', { type: 'swap_transfer', standard: 'bogus', signerId: acc.accountId, depositAddress: dep }), 400); rows.at(-1).endpoint = 'POST /v0/generate-intent';
const any = await api('POST', '/v0/quote', { ...req, dry: false, swapType: 'ANY_INPUT' });
rec('quote ANY_INPUT', '/v0/quote', 'post', { status: 200, body: any });
await depositIntents(acc, health.verifier, USDC.assetId, any.quote.depositAddress, '300000');
let w: any; for (let i = 0; i < 30; i++) { w = await call('GET', `/v0/any-input/withdrawals?depositAddress=${any.quote.depositAddress}`); if (w.body?.withdrawals) break; await sleep(3000); }
rec('any-input/withdrawals', '/v0/any-input/withdrawals', 'get', w);
rec('any-input/withdrawals unknown → 404', null, 'get', await call('GET', '/v0/any-input/withdrawals?depositAddress=nope'), 404); rows.at(-1).endpoint = 'GET /v0/any-input/withdrawals';
const nonce = (await import('node:crypto')).randomBytes(32).toString('base64');
const auth = rec('auth/authenticate', '/v0/auth/authenticate', 'post', await call('POST', '/v0/auth/authenticate', { signedData: await signNep413(acc, { message: JSON.stringify({ signer_id: acc.accountId, verifying_contract: 'tidepool-auth', deadline: new Date(Date.now() + 300_000).toISOString(), nonce, intents: [] }), nonce, recipient: 'tidepool-auth' }) }));
rec('auth/refresh', '/v0/auth/refresh', 'post', await call('POST', '/v0/auth/refresh', { refreshToken: auth.refreshToken }));
const H = { authorization: `Bearer ${auth.accessToken}` };
rec('account/balances', '/v0/account/balances', 'get', await call('GET', '/v0/account/balances', undefined, H));
rec('account/history', '/v0/account/history', 'get', await call('GET', '/v0/account/history?limit=3', undefined, H));
rec('account/balances no token → 401', null, 'get', await call('GET', '/v0/account/balances', undefined, { authorization: '' }), 401); rows.at(-1).endpoint = 'GET /v0/account/balances';
const ord = rec('orders create', '/v0/orders', 'post', await call('POST', '/v0/orders', { data: { type: 'orders', attributes: { orderType: 'LIMIT', baseAsset: WNEAR.assetId, quoteAsset: USDC.assetId, quantity: '100000000000000000000000', side: 'SELL', price: String(WNEAR.price * 20), depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS', confidentiality: 'public' } } }, H));
rec('orders get', '/v0/orders/{orderId}', 'get', await call('GET', `/v0/orders/${ord.data.id}`, undefined, H));
rec('orders list', '/v0/orders', 'get', await call('GET', '/v0/orders?page[size]=2', undefined, H));
rec('orders cancel', '/v0/orders/{orderId}/cancel', 'post', await call('POST', `/v0/orders/${ord.data.id}/cancel`, {}, H));
rec('orders no auth → 401', null, 'get', await call('GET', '/v0/orders', undefined, { authorization: '' }), 401); rows.at(-1).endpoint = 'GET /v0/orders';
rec('orders unknown → 404', null, 'get', await call('GET', '/v0/orders/ord_nope', undefined, H), 404); rows.at(-1).endpoint = 'GET /v0/orders/{orderId}';
const memo = await call('POST', '/v0/quote', { ...req, dry: false, depositMode: 'MEMO', depositType: 'ORIGIN_CHAIN', refundType: 'ORIGIN_CHAIN' });
rec('quote depositMode MEMO', '/v0/quote', 'post', memo); if (!memo.body?.quote?.depositMemo) { rows.at(-1).pass = false; rows.at(-1).issues.push('depositMemo missing'); }
rec('status MEMO (address + memo)', '/v0/status', 'get', await call('GET', `/v0/status?depositAddress=${memo.body.quote.depositAddress}&depositMemo=${memo.body.quote.depositMemo}`));

const result = { date: new Date().toISOString(), api: API, spec: SPEC_URL, specVersion: spec.info?.version, depositTx: txHash, depositAddress: dep, nearTxHashes: fin.swapDetails?.nearTxHashes, rows };
fs.writeFileSync('conformance-result.json', JSON.stringify(result, null, 2));
const md = ['| Check | Endpoint | HTTP | Spec | Result | Notes |', '| --- | --- | --- | --- | --- | --- |', ...rows.map(r => `| ${r.name} | \`${r.endpoint}\` | ${r.http} | ${r.specHttp} | ${r.pass ? '✅ pass' : '❌ fail'} | ${r.issues.join('; ').replace(/\|/g, '\\|') || '—'} |`)].join('\n');
fs.writeFileSync('conformance-result.md', md + '\n');
console.log(md);
process.exit(rows.every(r => r.pass) ? 0 : 1);
