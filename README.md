# tidepool-examples

**There is no official testnet for NEAR Intents / 1Click.** Mainnet 1Click moves real funds, so you cannot run a full quote → deposit → settle flow in development or CI. [Tidepool](https://www.usetidepool.tech) is a community-operated, testnet-only, 1Click-compatible API (same `/v0/tokens`, `/v0/quote`, `/v0/deposit/submit`, `/v0/status`) running the official `defuse` v0.4.2 verifier on NEAR testnet. This repo has runnable TypeScript scripts against it.

- Site: https://www.usetidepool.tech · Docs: https://www.usetidepool.tech/docs · Quickstart: https://www.usetidepool.tech/docs/quickstart
- [llms-full.txt](https://www.usetidepool.tech/llms-full.txt) · [openapi.json](https://www.usetidepool.tech/openapi.json) · [health](https://www.usetidepool.tech/v0/health)
- **Dev prompt for coding agents:** https://www.usetidepool.tech/docs/guides/agents#prompt-snippet
- Compatibility vs mainnet 1Click: https://www.usetidepool.tech/docs/resources/compatibility · Live conformance report: [CONFORMANCE.md](CONFORMANCE.md)

> **Trust model:** community-operated testnet. Tidepool runs the only maker and derives deposit-address keys on its server. Testnet only; **never send real assets**. Not affiliated with NEAR, Defuse or 1Click.

## Run

```bash
git clone https://github.com/zer0plugyut-afk/tidepool-examples && cd tidepool-examples
npm install
cp .env.example .env   # optional; everything has defaults
npm run first-swap
```

No account needed: if `NEAR_ACCOUNT_ID`/`NEAR_PRIVATE_KEY` are unset, a throwaway testnet account is created and its key is kept locally in `.example-account.json` (gitignored). Keys are never printed. Load `.env` with `node --env-file=.env` or your shell.

| Script | What it does |
| --- | --- |
| `npm run first-swap` | faucet → dry quote → live quote → deposit (INTENTS) → submit → poll status → explorer links |
| `npm run env-switch` | Same code against `ENV=TIDEPOOL` (testnet) or `ENV=ONECLICK` (mainnet `https://1click.chaindefuser.com`, dry quote only) |
| `npm run failure-cases [errors\|partial\|expired]` | Validation errors, partial deposit → `REFUNDED (PARTIAL_DEPOSIT)`, expired quote → `REFUNDED (DEADLINE_PASSED)` |
| `npm run evm-deposit` | Cross-chain: test USDC on Base/Arbitrum/Ethereum Sepolia → wNEAR on NEAR testnet. Needs `EVM_PRIVATE_KEY` (testnet-only) with ~0.001 Sepolia gas ETH; the script drips test USDC itself. `WITHDRAW=1` adds the return leg (wNEAR → USDC paid out on the EVM chain) |
| `npm run conformance` | Live check of Tidepool vs the official 1Click OpenAPI (status codes + required fields) |

Switching to production is one line: the base URL. `OpenAPI.BASE = 'https://1click.chaindefuser.com'` in the official SDK, or `ENV=ONECLICK` here — plus mainnet asset ids.

## Real output (production, 2026-10-27)

`npm run first-swap` against https://www.usetidepool.tech:

```
10:27:18 API https://www.usetidepool.tech account tidepool-try-1637abf0.testnet
10:27:20 faucet skipped: POST /v0/faucet 429: Rate limited: tidepool-try-1637abf0.testnet can use the intents faucet again after 2026-10-27T11:26:15.367Z
10:27:20 dry quote: 5 USDC -> 1.12795454818594115216 wNEAR (min 1116675002704081740638400)
10:27:21 live quote 62246afb-9048-48b4-baff-208f43cae1f8 depositAddress 3c0b2d7881f960e678337ca455b8eaa5995d01add489f1c4e940d19d1f74a402
10:27:23 deposit tx https://testnet.nearblocks.io/txns/1KRiiJ3Hd7BjZyBCuvyUSa29Bbwryq8mgFoq8mUGw9f
10:27:24 status KNOWN_DEPOSIT_TX
10:27:30 status SUCCESS
10:27:30 result {"status":"SUCCESS","amountIn":"5","amountOut":"1.12795454818594115216","intentHashes":["DgFS7m6BTLuwEZkRAZE5mqcxPCQtixn2cmRmU7k2BUKb","Ey7afMZQgJeHE4uJER2tqTKAt1f8jmuVNwyJ6bQWvDe1"],"nearTxHashes":["CHKkLCviwnZXUK7By7ASx8znfvP1zuCK9L15uRoqxQ3G"]}
10:27:30 explorer https://testnet.nearblocks.io/txns/CHKkLCviwnZXUK7By7ASx8znfvP1zuCK9L15uRoqxQ3G
```

Settlement tx: https://testnet.nearblocks.io/txns/CHKkLCviwnZXUK7By7ASx8znfvP1zuCK9L15uRoqxQ3G · deposit tx: https://testnet.nearblocks.io/txns/1KRiiJ3Hd7BjZyBCuvyUSa29Bbwryq8mgFoq8mUGw9f

`npm run failure-cases partial` / `expired`:

```
10:29:34 [partial] deposited half https://testnet.nearblocks.io/txns/BYcUTAKoeoJpoXwDRDiurktoCbJCWjSn2VbhgrYjaZfV
10:29:35 status PENDING_DEPOSIT
10:29:41 status INCOMPLETE_DEPOSIT
10:30:52 status REFUNDED
10:30:52 [partial] REFUNDED {"refundReason":"PARTIAL_DEPOSIT","refunded":"1"}
10:30:52    https://testnet.nearblocks.io/txns/J3CdhsZyWNnf9uLaHU2PnDvqWus4nqgcuXmbUCmiN99f
10:30:55 [expired] waiting for deadline 2026-10-27T10:32:00.617Z
10:32:08 [expired] deposited after deadline https://testnet.nearblocks.io/txns/9XumR899Jsv2ZyhNfML7JEf2D5TVvDRxEHbn8FSBexws
10:32:08 status PENDING_DEPOSIT
10:32:14 status REFUNDED
10:32:14 [expired] REFUNDED {"refundReason":"DEADLINE_PASSED","refunded":"2"}
10:32:14    https://testnet.nearblocks.io/txns/2PiciG95eZH8L7CrvReHaYbru97Kb4QK8ZNfeGF6AQXY
```

### EVM Sepolia run (2026-10-27, Base Sepolia, production API)

`WITHDRAW=1 EVM_PRIVATE_KEY=0x… EVM_CHAIN=base RECIPIENT=<near account> npm run evm-deposit` with demo wallet `0x38A9D3dB2Daf0f623c0b9777B64d3Fbc42e444Ad`:

```
10:38:01 faucet ok
10:38:01 depositAddress 0xfF5f621914D5aD12A04F3aDF6a59881A6E22B3E9 amountIn 2000000
10:38:02 deposit tx https://sepolia.basescan.org/tx/0x5ba48800252af24b01b667f826c6be36c51aaf7cd0e945c7581abb9e2af1cd4b
10:38:02 status KNOWN_DEPOSIT_TX
10:38:14 status PROCESSING
10:38:18 status SUCCESS
10:38:59 withdraw quote 1 wNEAR -> 4.402615 USDC on base
10:39:01 intents deposit tx https://testnet.nearblocks.io/txns/9ofqgKHeDkdFMhxxukMR3zCvVUEYTNpoynS268QtSBBb
10:39:11 withdraw result SUCCESS
```

| Leg | Transaction |
|---|---|
| 2 USDC deposit, Base Sepolia | [0x5ba48800…cd4b](https://sepolia.basescan.org/tx/0x5ba48800252af24b01b667f826c6be36c51aaf7cd0e945c7581abb9e2af1cd4b) |
| Credit + swap to wNEAR, NEAR testnet | [3bM6orWu…5end](https://testnet.nearblocks.io/txns/3bM6orWu8yyUxQ4X9ZHtcWFAjpBV1yAzK6mjwXmo5end) |
| Second run, deposit / settle | [0xa4f18…85bb](https://sepolia.basescan.org/tx/0xa4f1811b7f26b9fccf132365663d7baef4c821d5d7e0a4b6b2a39da333cf85bb) / [GdBWtxsE…bLn2](https://testnet.nearblocks.io/txns/GdBWtxsEUgMhAUNsQDbmcAxBnT377p1yhAKH67DybLn2) |
| Withdraw: 1 wNEAR into verifier | [9ofqgKHe…SBBb](https://testnet.nearblocks.io/txns/9ofqgKHeDkdFMhxxukMR3zCvVUEYTNpoynS268QtSBBb) |
| Withdraw: verifier settlement | [EC59veKh…bsYV](https://testnet.nearblocks.io/txns/EC59veKh6WCo4e5GvH6eEU5wGhZ7fhFJY85maoPwbsYV) |
| Withdraw: 4.40 USDC payout, Base Sepolia | [0x61d98633…73e8](https://sepolia.basescan.org/tx/0x61d98633e491db258ca9a18340e9d4e4f6e159f185e5269063aa7be6865a73e8) |

Deposit to SUCCESS took about 16 s; the withdrawal took about 12 s. The faucet allows one drip per address per hour (later calls return 429, which the script logs and skips).

## License

MIT
