// Minimal Bitcoin testnet4 helper for the examples: a p2wpkh wallet from a WIF key, spend to an address, via the public mempool.space testnet4 Esplora API.
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const NET = bitcoin.networks.testnet; // testnet4 uses the testnet address format and WIF prefix
export const ESPLORA = process.env.BTC_ESPLORA || 'https://mempool.space/testnet4/api';
export const btcExplorer = (txid: string) => `https://mempool.space/testnet4/tx/${txid}`;

export function wallet(wif: string) {
  const pair = ECPair.fromWIF(wif, NET);
  const p = bitcoin.payments.p2wpkh({ pubkey: Buffer.from(pair.publicKey), network: NET });
  return { pair, address: p.address!, script: Buffer.from(p.output!) };
}
export const newWif = () => ECPair.makeRandom({ network: NET }).toWIF();
const get = async (path: string) => { const r = await fetch(ESPLORA + path); if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`); return r; };
export const utxos = async (address: string) => (await (await get(`/address/${address}/utxo`)).json()) as { txid: string; vout: number; value: number; status: { confirmed: boolean } }[];
export const balance = async (address: string) => (await utxos(address)).filter(u => u.status.confirmed).reduce((s, u) => s + u.value, 0);

/** Send `sats` to `to` from the wallet's confirmed coins; change returns to the wallet. Returns the txid. */
export async function send(w: ReturnType<typeof wallet>, to: string, sats: number) {
  const feeRate = Math.max(2, Math.ceil((await (await get('/v1/fees/recommended')).json()).halfHourFee || 2));
  const coins = (await utxos(w.address)).filter(u => u.status.confirmed).sort((a, b) => b.value - a.value);
  const psbt = new bitcoin.Psbt({ network: NET });
  let sum = 0, used = 0;
  for (const c of coins) {
    psbt.addInput({ hash: c.txid, index: c.vout, witnessUtxo: { script: w.script, value: BigInt(c.value) } });
    sum += c.value; used++;
    const fee = (11 + 68 * used + 31 * 2) * feeRate;
    if (sum >= sats + fee) break;
  }
  const fee = (11 + 68 * used + 31 * 2) * feeRate;
  if (sum < sats + fee) throw new Error(`wallet ${w.address} holds ${sum} confirmed sats; needs ${sats + fee}. Get tBTC from https://cypherfaucet.com/btc-testnet`);
  psbt.addOutput({ address: to, value: BigInt(sats) });
  if (sum - sats - fee >= 294) psbt.addOutput({ address: w.address, value: BigInt(sum - sats - fee) });
  psbt.signAllInputs({ publicKey: Buffer.from(w.pair.publicKey), sign: (h: Buffer) => Buffer.from(w.pair.sign(h)) } as any);
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();
  const r = await fetch(ESPLORA + '/tx', { method: 'POST', body: tx.toHex() });
  if (!r.ok) throw new Error(`broadcast failed: ${r.status} ${await r.text()}`);
  return tx.getId();
}
