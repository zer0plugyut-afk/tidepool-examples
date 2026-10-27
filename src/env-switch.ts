// Same code, two environments. Only the base URL (and asset ids) change.
//   ENV=TIDEPOOL npm run env-switch   -> https://www.usetidepool.tech (testnet)
//   ENV=ONECLICK npm run env-switch   -> https://1click.chaindefuser.com (mainnet; dry quote only, nothing is sent)
import { api, say, API, ENV } from './lib.js';

const ASSETS = {
  TIDEPOOL: { from: 'nep141:usdc.tidepool-sandbox.testnet', to: 'nep141:wnear.tidepool-sandbox.testnet', who: 'alice.testnet' },
  ONECLICK: { from: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1', to: 'nep141:wrap.near', who: 'alice.near' },
}[ENV] ?? { from: 'nep141:usdc.tidepool-sandbox.testnet', to: 'nep141:wnear.tidepool-sandbox.testnet', who: 'alice.testnet' };

say('ENV', ENV, 'base URL', API);
const tokens = await api('GET', '/v0/tokens');
say('tokens', tokens.length);
const q = await api('POST', '/v0/quote', {
  dry: true, swapType: 'EXACT_INPUT', slippageTolerance: 100, originAsset: ASSETS.from, destinationAsset: ASSETS.to, amount: '10000000',
  depositType: 'INTENTS', refundTo: ASSETS.who, refundType: 'INTENTS', recipient: ASSETS.who, recipientType: 'INTENTS',
  deadline: new Date(Date.now() + 600_000).toISOString(),
});
say(`dry quote 10 USDC -> ${q.quote.amountOutFormatted} wNEAR (timeEstimate ${q.quote.timeEstimate}s)`);
