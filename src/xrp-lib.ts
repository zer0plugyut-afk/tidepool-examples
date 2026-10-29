// Minimal XRP Ledger testnet helpers (JSON-RPC over fetch, local signing with xrpl.js). Testnet only.
import { Wallet } from 'xrpl';

export const XRPL_RPC = (process.env.XRPL_RPC || 'https://testnet.xrpl-labs.com').replace(/\/$/, '');
export const XRPL_FAUCET = 'https://faucet.altnet.rippletest.net/accounts'; // official: 100 XRP per request. Tidepool never drips XRP.
export const xrpExplorer = (h: string) => `https://testnet.xrpl.org/transactions/${h}`;

export async function rpc(method: string, params: Record<string, unknown> = {}) {
  const r = await fetch(XRPL_RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params: [params] }) });
  const j = (await r.json()) as any;
  if (j.result?.status === 'error') throw new Error(`${method}: ${j.result.error_message || j.result.error}`);
  return j.result;
}
export const newWallet = () => Wallet.generate();
export const walletOf = (seed: string) => Wallet.fromSeed(seed);

/** Drops (1 XRP = 1,000,000 drops) held by an account, or 0n when it does not exist yet. */
export async function balance(address: string): Promise<bigint> {
  try { return BigInt((await rpc('account_info', { account: address, ledger_index: 'validated' })).account_data.Balance); } catch { return 0n; }
}
/** Fund an address from the official XRPL Testnet faucet (100 XRP). */
export async function fund(address: string) {
  const r = await fetch(XRPL_FAUCET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destination: address, userAgent: 'tidepool-examples' }) });
  if (!r.ok) throw new Error('XRPL faucet ' + r.status);
  const j = (await r.json()) as any;
  for (let i = 0; i < 30 && (await balance(address)) === 0n; i++) await new Promise(r => setTimeout(r, 2000));
  return j;
}
/** Send a native XRP Payment (optionally with a DestinationTag) and wait until it is validated. Returns the tx hash. */
export async function pay(w: Wallet, to: string, drops: string | bigint, tag?: string | number) {
  const info = await rpc('account_info', { account: w.classicAddress, ledger_index: 'current' });
  const fee = (await rpc('fee')).drops.open_ledger_fee as string;
  const ledger = (await rpc('ledger_current')).ledger_current_index as number;
  const tx: Record<string, unknown> = { TransactionType: 'Payment', Account: w.classicAddress, Destination: to, Amount: String(drops), Fee: fee, Sequence: info.account_data.Sequence, LastLedgerSequence: ledger + 20 };
  if (tag !== undefined && tag !== null && tag !== '') tx.DestinationTag = Number(tag);
  const signed = w.sign(tx as any);
  const sub = await rpc('submit', { tx_blob: signed.tx_blob });
  if (!String(sub.engine_result).startsWith('tes') && sub.engine_result !== 'terQUEUED') throw new Error(`submit ${sub.engine_result}: ${sub.engine_result_message}`);
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const t = await rpc('tx', { transaction: signed.hash }).catch(() => null);
    if (t?.validated) { const res = t.meta?.TransactionResult; if (res !== 'tesSUCCESS') throw new Error('payment failed: ' + res); return signed.hash; }
  }
  throw new Error('payment was not validated in time: ' + signed.hash);
}
