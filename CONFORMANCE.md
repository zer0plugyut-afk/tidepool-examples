# Tidepool conformance report

- **Date:** 2026-10-28 (re-run at 05:50 UTC; previous full run 2026-10-27 11:04 UTC, also 31 / 31)
- **Target:** https://www.usetidepool.tech (production)
- **Spec:** official 1Click OpenAPI `https://1click.chaindefuser.com/docs/v0/openapi.yaml`, version 0.1.10
- **Method:** `npm run conformance` ([src/conformance.ts](src/conformance.ts)) makes real calls with faucet test tokens and compares HTTP status codes and required fields / enums / primitive types of each success response against the spec schemas (`TokenResponse`, `QuoteResponse`, `GetExecutionStatusResponse`, `SubmitDepositTxResponse`, plus the auth, account, any-input, generate/submit-intent and orders schemas, with `oneOf` and `nullable` support).
- **Live swap used:** deposit tx [9guTLzzQ…](https://testnet.nearblocks.io/txns/9guTLzzQNW6rmUjrq8DJ2vDzSXFPrK6QagukkV1f4edg), settlement [CujXrc1m…](https://testnet.nearblocks.io/txns/CujXrc1mdVRq2SwmoWLEwT9R9X9ZLfEpT7vPnkx9WcfN)

## Result: 31 / 31 pass

| Check | Endpoint | HTTP | Spec | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| tokens | `GET /v0/tokens` | 200 | 200 | ✅ pass | — |
| health (Tidepool extension) | `GET /v0/health` | 200 | 200 | ✅ pass | — |
| openapi.json reachable | `GET /openapi.json` | 200 | 200 | ✅ pass | — |
| quote (dry) | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| quote (live) | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| status (before deposit) | `GET /v0/status` | 200 | 200 | ✅ pass | — |
| deposit/submit | `POST /v0/deposit/submit` | 200 | 200 | ✅ pass | — |
| status polling (KNOWN_DEPOSIT_TX → PROCESSING → SUCCESS) | `GET /v0/status` | 200 | 200 | ✅ pass | — |
| status unknown address → 404 | `GET /v0/status` | 404 | 404 | ✅ pass | — |
| quote bad input → 400 | `POST /v0/quote` | 400 | 400 | ✅ pass | — |
| quote with appFees | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| generate-intent (nep413) | `POST /v0/generate-intent` | 200 | 200 | ✅ pass | — |
| submit-intent | `POST /v0/submit-intent` | 200 | 200 | ✅ pass | — |
| signed-intent swap → SUCCESS | `GET /v0/status` | 200 | 200 | ✅ pass | — |
| generate-intent bad standard → 400 | `POST /v0/generate-intent` | 400 | 400 | ✅ pass | — |
| quote ANY_INPUT | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| any-input/withdrawals | `GET /v0/any-input/withdrawals` | 200 | 200 | ✅ pass | — |
| any-input/withdrawals unknown → 404 | `GET /v0/any-input/withdrawals` | 404 | 404 | ✅ pass | — |
| auth/authenticate | `POST /v0/auth/authenticate` | 200 | 200 | ✅ pass | — |
| auth/refresh | `POST /v0/auth/refresh` | 200 | 200 | ✅ pass | — |
| account/balances | `GET /v0/account/balances` | 200 | 200 | ✅ pass | — |
| account/history | `GET /v0/account/history` | 200 | 200 | ✅ pass | — |
| account/balances no token → 401 | `GET /v0/account/balances` | 401 | 401 | ✅ pass | — |
| orders create | `POST /v0/orders` | 201 | 201 | ✅ pass | — |
| orders get | `GET /v0/orders/{orderId}` | 200 | 200 | ✅ pass | — |
| orders list | `GET /v0/orders` | 200 | 200 | ✅ pass | — |
| orders cancel | `POST /v0/orders/{orderId}/cancel` | 201 | 201 | ✅ pass | — |
| orders no auth → 401 | `GET /v0/orders` | 401 | 401 | ✅ pass | — |
| orders unknown → 404 | `GET /v0/orders/{orderId}` | 404 | 404 | ✅ pass | — |
| quote depositMode MEMO | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| status MEMO (address + memo) | `GET /v0/status` | 200 | 200 | ✅ pass | — |

## Found and fixed

First run (10:29 UTC), core endpoints:

| Issue | Before | After |
| --- | --- | --- |
| `POST /v0/quote` success status | 201 | 200 (spec) |
| `POST /v0/deposit/submit` success status | 201 | 200 (spec) |

Before the fix (same day, 10:26 UTC) 7/10 passed; the three failures were those status codes. No field-name or shape mismatches were found.

Feature run (10:50 UTC), 25/31 before fixes:

| Issue | Before | After |
| --- | --- | --- |
| `GET /v0/any-input/withdrawals` `withdrawals` | array | single `AnyInputQuoteWithdrawal` object (spec); full page moved to `tidepool.withdrawals` |
| `GET /v0/orders` | no `links` | `links.next` (spec) plus `meta.nextCursor` |
| Checker: order `payouts: null` flagged | false failure | checker honours `nullable` / `oneOf` |

## Known deviations (documented)

- `confidentiality` / `CONFIDENTIAL_INTENTS`: accepted and ignored; settlement is public.
- Settlement distinction: since [Oct 27, 2026](https://docs.near-intents.org/changelog/entries/2026-10-27-1click-confidential.md) mainnet 1Click settles every swap confidentially and `nearTxHashes` lists only shield/unshield; Tidepool testnet swaps settle publicly and include the swap hash, because confidential settlement runs on NEAR's private infrastructure, which isn't exposed to outside builders. Rely on `status`, not a swap hash.
- `/v0/account/balances`: verifier balances only, `source: private`.
- `/v0/any-input/withdrawals`: extra `tidepool.withdrawals` page array.
- `/v0/orders`: filled once by the Tidepool maker (no partial fills); deadline 7 d default, 30 d max.
- `depositMode: MEMO`: NEAR-native `ORIGIN_CHAIN` tokens only; `/v0/deposit/submit` needs `nearSenderAccount`.
- `/v0/generate-intent`: `INTENTS`-deposit quotes only; `webauthn` / `ton_connect` are submit-only.
- `/v0/auth/authenticate`: `nep413`, `raw_ed25519`, `erc191` only. JWTs are Tidepool-only.

See [Compatibility](https://www.usetidepool.tech/docs/resources/compatibility).

Re-run any time with `npm run conformance`.
