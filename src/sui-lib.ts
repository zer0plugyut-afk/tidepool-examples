// Minimal Sui testnet helpers over gRPC (the public JSON-RPC is deprecated). @mysten/sui 1.x cannot resolve a transaction through gRPC
// on its own, so gas coins, price and budget are filled in explicitly and the transaction is built offline.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export const sui = new SuiGrpcClient({ network: 'testnet', baseUrl: process.env.SUI_GRPC || 'https://fullnode.testnet.sui.io:443' });
export const suiscan = (digest: string) => `https://suiscan.xyz/testnet/tx/${digest}`;

export async function coinSum(owner: string, coinType = '0x2::sui::SUI') {
  const r: any = await sui.core.getCoins({ address: owner, coinType, limit: 200 });
  return r.objects.reduce((a: bigint, o: any) => a + BigInt(o.balance), 0n) as bigint;
}

/** Build, sign and execute a transaction paid with the signer's SUI coins; returns the digest once it is checkpointed. */
export async function run(signer: Ed25519Keypair, build: (tx: Transaction) => void): Promise<string> {
  const owner = signer.toSuiAddress();
  const coins: any = await sui.core.getCoins({ address: owner, coinType: '0x2::sui::SUI', limit: 10 });
  if (!coins.objects.length) throw new Error(`${owner} has no SUI coins: get testnet SUI at https://faucet.sui.io`);
  const tx = new Transaction(); build(tx);
  tx.setSender(owner);
  tx.setGasPayment(coins.objects.map((o: any) => ({ objectId: o.id, version: o.version, digest: o.digest })));
  tx.setGasPrice(BigInt((await sui.core.getReferenceGasPrice() as any).referenceGasPrice));
  tx.setGasBudget(20_000_000n);
  const bytes = await tx.build();
  const { signature } = await signer.signTransaction(bytes);
  // Raw gRPC calls: on the public node, core.executeTransaction's default read mask is rejected.
  const { response } = await (sui as any).transactionExecutionService.executeTransaction({
    transaction: { bcs: { value: bytes } },
    signatures: [{ bcs: { value: fromBase64(signature) }, signature: { oneofKind: undefined } }],
    readMask: { paths: ['digest', 'effects.status'] },
  });
  const t = response.transaction;
  if (t?.effects?.status?.success === false) throw new Error('sui tx failed: ' + JSON.stringify(t.effects.status.error, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  for (let i = 0; i < 20; i++) { // wait until the fullnode has checkpointed it so the next transaction sees the new object versions
    try { const r = await (sui as any).ledgerService.getTransaction({ digest: t.digest, readMask: { paths: ['digest', 'checkpoint'] } }); if (r.response.transaction?.checkpoint !== undefined) break; } catch { /* not indexed yet */ }
    await new Promise(r => setTimeout(r, 700));
  }
  return t.digest as string;
}
