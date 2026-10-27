// Live conformance check: Tidepool vs the official 1Click OpenAPI spec.
// Runs real calls (tokens, dry + live quote, deposit, submit, status polling, health, openapi.json) and compares
// HTTP status codes and required fields with the spec's success responses. Writes conformance-result.json + a Markdown table.
//   npm run conformance
import fs from 'node:fs';
import { parse } from 'yaml';
import { api, call, account, depositIntents, poll, say, API } from './lib.js';

const SPEC_URL = 'https://1click.chaindefuser.com/docs/v0/openapi.yaml';
const spec = parse(await (await fetch(SPEC_URL)).text());
const S = spec.components.schemas;
const ref = (x: any): any => (x?.$ref ? S[x.$ref.split('/').pop()] : x);
// Recursively list missing required fields (and type mismatches for primitives) for a value against a schema.
function check(schema: any, v: any, path = ''): string[] {
  schema = ref(schema); if (!schema) return [];
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
const schemaFor = (p: string, m: string) => spec.paths[p][m].responses['200']?.content?.['application/json']?.schema;
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

const result = { date: new Date().toISOString(), api: API, spec: SPEC_URL, specVersion: spec.info?.version, depositTx: txHash, depositAddress: dep, nearTxHashes: fin.swapDetails?.nearTxHashes, rows };
fs.writeFileSync('conformance-result.json', JSON.stringify(result, null, 2));
const md = ['| Check | Endpoint | HTTP | Spec | Result | Notes |', '| --- | --- | --- | --- | --- | --- |', ...rows.map(r => `| ${r.name} | \`${r.endpoint}\` | ${r.http} | ${r.specHttp} | ${r.pass ? '✅ pass' : '❌ fail'} | ${r.issues.join('; ').replace(/\|/g, '\\|') || '—'} |`)].join('\n');
fs.writeFileSync('conformance-result.md', md + '\n');
console.log(md);
process.exit(rows.every(r => r.pass) ? 0 : 1);
