// Cross-chain: deposit test USDC on an EVM Sepolia chain, receive wNEAR on NEAR testnet.
// Needs an EVM key with a little Sepolia gas ETH on that chain (the Tidepool faucet mints USDC, not gas).
//   EVM_PRIVATE_KEY=0x... EVM_CHAIN=base RECIPIENT=you.testnet npm run evm-deposit
// WITHDRAW=1 adds the return leg: 1 wNEAR from your verifier (intents) balance -> USDC paid out on the EVM chain
// (uses the lib.ts NEAR account: NEAR_ACCOUNT_ID/NEAR_PRIVATE_KEY or the auto-created .example-account.json).
// EVM_CHAIN: base | arb | eth. Never use a key that holds mainnet funds.
import { createWalletClient, createPublicClient, http, erc20Abi, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, arbitrumSepolia, sepolia } from 'viem/chains';
import { api, poll, say, units, account, depositIntents, explorer } from './lib.js';

const KEY = process.env.EVM_PRIVATE_KEY as Hex; if (!KEY) throw new Error('set EVM_PRIVATE_KEY (testnet-only key)');
const CHAIN = process.env.EVM_CHAIN || 'base';
const chain = { base: baseSepolia, arb: arbitrumSepolia, eth: sepolia }[CHAIN]!;
const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const evm = privateKeyToAccount(KEY);
const wallet = createWalletClient({ account: evm, chain, transport: http(process.env.EVM_RPC) });
const pub = createPublicClient({ chain, transport: http(process.env.EVM_RPC) });

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === CHAIN), tOut = tokens.find((t: any) => t.symbol === 'wNEAR' && t.blockchain === 'near');
say('EVM', evm.address, 'chain', CHAIN, 'token', tIn.contractAddress);
try { await api('POST', '/v0/faucet', { chain: CHAIN, address: evm.address }); say('faucet ok'); } catch (e: any) { say('faucet skipped:', e.message); }

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units('2', tIn.decimals),
  depositType: 'ORIGIN_CHAIN', refundTo: evm.address, refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 1800_000).toISOString(),
});
say('depositAddress', q.quote.depositAddress, 'amountIn', q.quote.amountIn);
const txHash = await wallet.writeContract({ address: tIn.contractAddress, abi: erc20Abi, chain, account: evm, functionName: 'transfer', args: [q.quote.depositAddress, BigInt(q.quote.amountIn)] });
await pub.waitForTransactionReceipt({ hash: txHash });
say('deposit tx', `${chain.blockExplorers?.default.url}/tx/${txHash}`);
await api('POST', '/v0/deposit/submit', { txHash, depositAddress: q.quote.depositAddress });
const st = await poll(q.quote.depositAddress, 900_000);
say('result', st.status, JSON.stringify(st.swapDetails.destinationChainTxHashes ?? st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);

if (process.env.WITHDRAW) {
  const acc = await account();
  const { verifier } = await api('GET', '/v0/health');
  try { await api('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents' }); say('near faucet ok'); } catch (e: any) { say('near faucet skipped:', e.message); }
  const w = await api('POST', '/v0/quote', {
    dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tOut.assetId, destinationAsset: tIn.assetId, amount: units(process.env.WITHDRAW_AMOUNT || '1', tOut.decimals),
    depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: evm.address, recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 1800_000).toISOString(),
  });
  say('withdraw quote', w.quote.amountInFormatted, 'wNEAR ->', w.quote.amountOutFormatted, 'USDC on', CHAIN);
  const h = await depositIntents(acc, verifier, tOut.assetId, w.quote.depositAddress, w.quote.amountIn);
  say('intents deposit tx', explorer(h));
  await api('POST', '/v0/deposit/submit', { txHash: h, depositAddress: w.quote.depositAddress, nearSenderAccount: acc.accountId });
  const ws = await poll(w.quote.depositAddress, 900_000);
  say('withdraw result', ws.status, JSON.stringify(ws.swapDetails.destinationChainTxHashes ?? ws.swapDetails.nearTxHashes));
  process.exit(ws.status === 'SUCCESS' ? 0 : 1);
}
