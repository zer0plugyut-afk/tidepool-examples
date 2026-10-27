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

export async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  // Tidepool accepts any key; on mainnet 1Click set ONECLICK_JWT for fee-free quotes.
  const jwt = process.env.ONECLICK_JWT || process.env.TIDEPOOL_KEY;
  if (jwt) headers.authorization = `Bearer ${jwt}`;
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}
export async function api(method: string, path: string, body?: unknown) {
  const r = await call(method, path, body);
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status}: ${r.body?.message}`);
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

export async function poll(depositAddress: string, timeoutMs = 300_000, onChange?: (st: any) => void) {
  let last; const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await call('GET', `/v0/status?depositAddress=${depositAddress}`);
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
