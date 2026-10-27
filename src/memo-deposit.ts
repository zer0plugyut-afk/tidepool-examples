// depositMode MEMO: one shared NEAR address for everybody; your deposit is matched by the ft_transfer memo.
import { api, account, poll, say, units, explorer, faucet, deadlineIn } from './lib.js';
const acc = await account();
const tokens = await api('GET', '/v0/tokens');
const usdc = tokens.find((t: any) => t.symbol === 'USDC'), wnear = tokens.find((t: any) => t.symbol === 'wNEAR');
await faucet(acc.accountId, 'wallet'); // USDC into the wallet (not the verifier)
const q = await api('POST', '/v0/quote', { dry: false, swapType: 'EXACT_INPUT', depositMode: 'MEMO', slippageTolerance: 100, originAsset: usdc.assetId, destinationAsset: wnear.assetId, amount: units('1', 6), depositType: 'ORIGIN_CHAIN', refundTo: acc.accountId, refundType: 'ORIGIN_CHAIN', recipient: acc.accountId, recipientType: 'DESTINATION_CHAIN', deadline: deadlineIn(900_000) });
const { depositAddress, depositMemo, amountIn } = q.quote; say('shared address', depositAddress, 'memo', depositMemo);
const out = await acc.me.functionCall({ contractId: usdc.contractAddress, methodName: 'ft_transfer', args: { receiver_id: depositAddress, amount: amountIn, memo: depositMemo }, attachedDeposit: 1n, gas: 30_000_000_000_000n });
const txHash = out.transaction.hash; say('ft_transfer with memo', explorer(txHash));
await api('POST', '/v0/deposit/submit', { txHash, depositAddress, memo: depositMemo, nearSenderAccount: acc.accountId });
const st = await poll(depositAddress, 300_000, undefined, depositMemo);
for (const h of st.swapDetails.nearTxHashes || []) say('explorer', explorer(h));
process.exit(st.status === 'SUCCESS' ? 0 : 1);
