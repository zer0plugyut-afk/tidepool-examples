// Cross-chain: deposit XRP Ledger testnet XRP (MEMO deposit mode), receive NEAR testnet USDC.
// The XRP Ledger has no per-quote deposit addresses: every quote shares ONE depositAddress (the treasury) and is told apart by a numeric
// depositMemo, which is the Payment's DestinationTag (a uint32), exactly like 1Click. So the quote needs depositMode "MEMO".
//   RECIPIENT=you.testnet npm run xrp-deposit                       (generates a throwaway wallet and funds it from the official faucet)
//   XRP_SEED=s... RECIPIENT=you.testnet npm run xrp-deposit         (use your own TESTNET family seed; never one that holds real funds)
// AMOUNT (XRP, default 5). XRP is capped at 100 XRP per swap on Tidepool's XRP Ledger testnet bridge. Tidepool never drips XRP:
// the official faucet is https://faucet.altnet.rippletest.net/accounts (100 XRP per request). XRPL_RPC overrides the public testnet RPC.
import { api, poll, say, units } from './lib.js';
import { newWallet, walletOf, balance, fund, pay, xrpExplorer } from './xrp-lib.js';

const RECIPIENT = process.env.RECIPIENT; if (!RECIPIENT) throw new Error('set RECIPIENT (a NEAR testnet account)');
const AMOUNT = process.env.AMOUNT || '5';
const w = process.env.XRP_SEED ? walletOf(process.env.XRP_SEED) : newWallet();
if ((await balance(w.classicAddress)) === 0n) { say('funding', w.classicAddress, 'from the official XRPL testnet faucet'); await fund(w.classicAddress); }
say('XRP Ledger', w.classicAddress, 'balance (drops)', String(await balance(w.classicAddress)));

const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === 'XRP' && t.blockchain === 'xrp'), tOut = tokens.find((t: any) => t.symbol === 'USDC' && t.blockchain === 'near');
if (!tIn) throw new Error('this Tidepool server has no XRP Ledger testnet bridge');
say('asset', tIn.assetId);

const q = await api('POST', '/v0/quote', {
  dry: false, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'ORIGIN_CHAIN', depositMode: 'MEMO', refundTo: w.classicAddress, refundType: 'ORIGIN_CHAIN', recipient: RECIPIENT, recipientType: 'DESTINATION_CHAIN',
  deadline: new Date(Date.now() + 1800_000).toISOString(),
});
const { depositAddress, depositMemo } = q.quote;
say('deposit to', depositAddress, 'destination tag', depositMemo, '|', q.quote.amountInFormatted, 'XRP ->', q.quote.amountOutFormatted, 'USDC');
const hash = await pay(w, depositAddress, q.quote.amountIn, depositMemo);
say('deposit tx', xrpExplorer(hash));
// Optional: the worker detects the payment on its own; submitting the hash just speeds up the status change.
await api('POST', '/v0/deposit/submit', { txHash: hash, depositAddress, memo: depositMemo });
const st = await poll(depositAddress, 900_000, undefined, depositMemo);
say('result', st.status, JSON.stringify(st.swapDetails.nearTxHashes));
if (st.status !== 'SUCCESS') process.exit(1);
