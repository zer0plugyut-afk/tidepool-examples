// First swap on Tidepool: faucet -> dry quote -> live quote -> deposit -> submit -> poll status -> explorer links.
//   npm run first-swap            (USDC -> wNEAR, 5 USDC)
//   FROM=wNEAR TO=USDC AMOUNT=1 npm run first-swap
import { api, account, depositIntents, poll, say, units, explorer, API } from './lib.js';

const FROM = process.env.FROM || 'USDC', TO = process.env.TO || 'wNEAR', AMOUNT = process.env.AMOUNT || '5';
if (!API.includes('usetidepool') && !process.env.TIDEPOOL_URL) throw new Error('first-swap uses the Tidepool faucet and testnet accounts; run with ENV=TIDEPOOL');
const acc = await account();
say('API', API, 'account', acc.accountId);
const tokens = await api('GET', '/v0/tokens');
const tIn = tokens.find((t: any) => t.symbol === FROM && t.blockchain === 'near'), tOut = tokens.find((t: any) => t.symbol === TO && t.blockchain === 'near');
const { verifier } = await api('GET', '/v0/health');

// 1. faucet: test tokens into your verifier (intents) balance. Rate limited to one drip per hour.
try { const f = await api('POST', '/v0/faucet', { accountId: acc.accountId, mode: 'intents' }); say('faucet', f.transactions.map((t: any) => t.explorerUrl).join(' ')); }
catch (e: any) { say('faucet skipped:', e.message); }

// 2. quotes
const req = {
  swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: tIn.assetId, destinationAsset: tOut.assetId, amount: units(AMOUNT, tIn.decimals),
  depositType: 'INTENTS', refundTo: acc.accountId, refundType: 'INTENTS', recipient: acc.accountId, recipientType: 'INTENTS',
  deadline: new Date(Date.now() + 600_000).toISOString(),
};
const dry = await api('POST', '/v0/quote', { ...req, dry: true });
say(`dry quote: ${dry.quote.amountInFormatted} ${FROM} -> ${dry.quote.amountOutFormatted} ${TO} (min ${dry.quote.minAmountOut})`);
const live = await api('POST', '/v0/quote', { ...req, dry: false });
const { depositAddress, amountIn } = live.quote;
say('live quote', live.correlationId, 'depositAddress', depositAddress);

// 3. deposit + submit
const txHash = await depositIntents(acc, verifier, tIn.assetId, depositAddress, amountIn);
say('deposit tx', explorer(txHash));
await api('POST', '/v0/deposit/submit', { txHash, depositAddress, nearSenderAccount: acc.accountId });

// 4. poll
const st = await poll(depositAddress);
const d = st.swapDetails;
say('result', JSON.stringify({ status: st.status, amountIn: d.amountInFormatted, amountOut: d.amountOutFormatted, intentHashes: d.intentHashes, nearTxHashes: d.nearTxHashes }));
for (const h of d.nearTxHashes || []) say('explorer', explorer(h));
process.exit(st.status === 'SUCCESS' ? 0 : 1);
