// Shared helpers: API client, testnet account, INTENTS / ORIGIN_CHAIN deposits, status polling.
// Keys come from env vars or a throwaway account file (.example-account.json, gitignored). Keys are never printed.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { connect, keyStores, KeyPair } from 'near-api-js';
import bs58 from 'bs58';

// ---- environment switch: TIDEPOOL (testnet, default) or ONECLICK (mainnet 1Click) ----
export const BASE_URLS = { TIDEPOOL: 'https://www.usetidepool.tech', ONECLICK: 'https://1click.chaindefuser.com' } as const;
export const ENV = (process.env.ENV || 'TIDEPOOL').toUpperCase() as keyof typeof BASE_URLS;
export const API = process.env.TIDEPOOL_URL || BASE_URLS[ENV] || BASE_URLS.TIDEPOOL;
const RPC = process.env.NEAR_RPC || 'https://test.rpc.fastnear.com';

export const say = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const units = (s: string, d: number) => { const [i, f = ''] = String(s).split('.'); return BigInt(i + (f + '0'.repeat(d)).slice(0, d)).toString(); };

export async function call(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Tidepool accepts any key; on mainnet 1Click set ONECLICK_JWT for fee-free quotes.
  const jwt = process.env.ONECLICK_JWT || process.env.TIDEPOOL_KEY;
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  Object.assign(headers, extra);
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
export async function api(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
  const r = await call(method, path, body, extra);
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status}: ${r.body?.message ?? JSON.stringify(r.body?.errors)}`);
  return r.body;
}

export async function account() {
  const keyStore = new keyStores.InMemoryKeyStore();
  let accountId = process.env.NEAR_ACCOUNT_ID;
  if (accountId) await keyStore.setKey('testnet', accountId, KeyPair.fromString(process.env.NEAR_PRIVATE_KEY as any));
  else {
    const f = new URL('../.example-account.json', import.meta.url);
    if (!fs.existsSync(f)) {
      const kp = KeyPair.fromRandom('ed25519'); const id = `tidepool-try-${crypto.randomBytes(4).toString('hex')}.testnet`;
      const r = await fetch('https://helper.nearprotocol.com/account', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: kp.getPublicKey().toString() }) });
      if (!r.ok) throw new Error('could not create a testnet account: ' + r.status);
      fs.writeFileSync(f, JSON.stringify({ accountId: id, privateKey: kp.toString() }), { mode: 0o600 });
    }
    const k = JSON.parse(fs.readFileSync(f, 'utf8')); accountId = k.accountId as string; await keyStore.setKey('testnet', accountId, KeyPair.fromString(k.privateKey));
  }
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore } as any);
  return { accountId: accountId!, keyStore, me: await near.account(accountId!) };
}

// INTENTS deposit: a NEP-413 signed `transfer` intent from your verifier balance to the deposit address.
export async function depositIntents(acc: Awaited<ReturnType<typeof account>>, verifier: string, assetId: string, depositAddress: string, amount: string) {
  const { me, keyStore, accountId } = acc;
  const kp = await keyStore.getKey('testnet', accountId); const pk = kp.getPublicKey().toString();
  if (!(await me.viewFunction({ contractId: verifier, methodName: 'has_public_key', args: { account_id: accountId, public_key: pk } })))
    await me.functionCall({ contractId: verifier, methodName: 'add_public_key', args: { public_key: pk }, attachedDeposit: 1n, gas: 30_000_000_000_000n });
  const nonce = crypto.randomBytes(32); if (nonce[0] === 0x56 && nonce[1] === 0x28) nonce[0] ^= 0xff;
  const message = JSON.stringify({ signer_id: accountId, verifying_contract: verifier, deadline: new Date(Date.now() + 120_000).toISOString(), nonce: nonce.toString('base64'), intents: [{ intent: 'transfer', receiver_id: depositAddress, tokens: { [assetId]: amount } }] });
  const s = (x: string) => { const b = Buffer.from(x); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const hash = crypto.createHash('sha256').update(Buffer.concat([tag, s(message), nonce, s(verifier), Buffer.from([0])])).digest();
  const signed = { standard: 'nep413', payload: { message, nonce: nonce.toString('base64'), recipient: verifier }, public_key: pk, signature: 'ed25519:' + bs58.encode(Buffer.from(kp.sign(hash).signature)) };
  const out = await me.functionCall({ contractId: verifier, methodName: 'execute_intents', args: { signed: [signed] }, gas: 100_000_000_000_000n });
  return out.transaction.hash as string;
}

export async function poll(depositAddress: string, timeoutMs = 300_000, onChange?: (st: any) => void, memo?: string) {
  let last; const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await call('GET', `/v0/status?depositAddress=${depositAddress}${memo ? `&depositMemo=${memo}` : ''}`);
    if (r.status >= 500) { await sleep(3000); continue; } // transient (e.g. during a deploy): retry
    if (r.status >= 400) throw new Error(`status ${r.status}: ${r.body?.message}`);
    const st = r.body;
    if (st.status !== last) { last = st.status; say('status', st.status); onChange?.(st); }
    if (['SUCCESS', 'REFUNDED', 'FAILED'].includes(st.status)) return st;
    await sleep(3000);
  }
  throw new Error(`no final status after ${timeoutMs / 1000}s (last ${last})`);
}
export const explorer = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;

// ---- signing helpers (signed-intent flow, auth) ----
export type Acc = Awaited<ReturnType<typeof account>>;
export async function signNep413(acc: Acc, payload: { message: string; nonce: string; recipient: string }) {
  const kp = await acc.keyStore.getKey('testnet', acc.accountId);
  const s = (x: string) => { const b = Buffer.from(x); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return Buffer.concat([l, b]); };
  const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
  const hash = crypto.createHash('sha256').update(Buffer.concat([tag, s(payload.message), Buffer.from(payload.nonce, 'base64'), s(payload.recipient), Buffer.from([0])])).digest();
  return { standard: 'nep413', payload, public_key: kp.getPublicKey().toString(), signature: 'ed25519:' + bs58.encode(Buffer.from(kp.sign(hash).signature)) };
}
// Named accounts must register their key on the verifier once (implicit accounts don't need to).
export async function ensureVerifierKey(acc: Acc, verifier: string) {
  const pk = (await acc.keyStore.getKey('testnet', acc.accountId)).getPublicKey().toString();
  if (!(await acc.me.viewFunction({ contractId: verifier, methodName: 'has_public_key', args: { account_id: acc.accountId, public_key: pk } })))
    await acc.me.functionCall({ contractId: verifier, methodName: 'add_public_key', args: { public_key: pk }, attachedDeposit: 1n, gas: 30_000_000_000_000n });
}
// 1Click signed-intent deposit: generate-intent -> sign -> submit-intent
export async function fundViaSignedIntent(acc: Acc, depositAddress: string, headers?: Record<string, string>) {
  const { intent } = await api('POST', '/v0/generate-intent', { type: 'swap_transfer', standard: 'nep413', signerId: acc.accountId, depositAddress }, headers);
  const signedData = await signNep413(acc, intent.payload);
  return api('POST', '/v0/submit-intent', { type: 'swap_transfer', signedData }, headers);
}
export async function login(acc: Acc) {
  const nonce = crypto.randomBytes(32);
  const message = JSON.stringify({ signer_id: acc.accountId, verifying_contract: 'tidepool-auth', deadline: new Date(Date.now() + 300_000).toISOString(), nonce: nonce.toString('base64'), intents: [] });
  const signedData = await signNep413(acc, { message, nonce: nonce.toString('base64'), recipient: 'tidepool-auth' });
  return api('POST', '/v0/auth/authenticate', { signedData });
}
export const verifierBalance = (acc: Acc, verifier: string, account_id: string, token_id: string) => acc.me.viewFunction({ contractId: verifier, methodName: 'mt_balance_of', args: { account_id, token_id } }) as Promise<string>;
export async function faucet(accountId: string, mode = 'intents') {
  try { const f = await api('POST', '/v0/faucet', { accountId, mode }); say('faucet', f.transactions.map((t: any) => t.explorerUrl).join(' ')); } catch (e: any) { say('faucet skipped:', e.message); }
}
export const deadlineIn = (ms: number) => new Date(Date.now() + ms).toISOString();
