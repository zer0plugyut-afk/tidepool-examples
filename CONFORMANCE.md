# Tidepool conformance report

- **Date:** 2026-10-27 (run at 10:29 UTC)
- **Target:** https://www.usetidepool.tech (production)
- **Spec:** official 1Click OpenAPI `https://1click.chaindefuser.com/docs/v0/openapi.yaml`, version 0.1.10
- **Method:** `npm run conformance` ([src/conformance.ts](src/conformance.ts)) makes real calls with faucet test tokens and compares HTTP status codes and required fields / enums / primitive types of each success response against the spec schemas (`TokenResponse`, `QuoteResponse`, `GetExecutionStatusResponse`, `SubmitDepositTxResponse`).
- **Live swap used:** deposit tx [AZe8w6tm…](https://testnet.nearblocks.io/txns/AZe8w6tmquxAdrakNqXLuwVG9i6ZJ2bFJZD5BFfmmzEd), settlement [F5xght3D…](https://testnet.nearblocks.io/txns/F5xght3DW89hML6NZYu9vmCJ43GnriJDZFNVabQ4RYwQ)

## Result: 10 / 10 pass

| Check | Endpoint | HTTP | Spec | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| tokens | `GET /v0/tokens` | 200 | 200 | ✅ pass | — |
| health (Tidepool extension) | `GET /v0/health` | 200 | 200 | ✅ pass | — |
| openapi.json reachable | `GET /openapi.json` | 200 | 200 | ✅ pass | — |
| quote (dry) | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| quote (live) | `POST /v0/quote` | 200 | 200 | ✅ pass | — |
| status (before deposit) | `GET /v0/status` | 200 | 200 | ✅ pass | — |
| deposit/submit | `POST /v0/deposit/submit` | 200 | 200 | ✅ pass | — |
| status polling (KNOWN_DEPOSIT_TX → SUCCESS) | `GET /v0/status` | 200 | 200 | ✅ pass | — |
| status unknown address → 404 | `GET /v0/status` | 404 | 404 | ✅ pass | — |
| quote bad input → 400 | `POST /v0/quote` | 400 | 400 | ✅ pass | — |

## Found and fixed in this run

| Issue | Before | After |
| --- | --- | --- |
| `POST /v0/quote` success status | 201 | 200 (spec) |
| `POST /v0/deposit/submit` success status | 201 | 200 (spec) |

Before the fix (same day, 10:26 UTC) 7/10 passed; the three failures were those status codes. No field-name or shape mismatches were found.

## Not covered (by design)

1Click endpoints Tidepool does not implement yet return 404: `/v0/auth/*`, `/v0/account/*`, `/v0/any-input/withdrawals`, `/v0/generate-intent`, `/v0/submit-intent`, `/v0/orders`. Unsupported request options: `depositMode: MEMO`, `swapType: ANY_INPUT`, `appFees` (400), `confidentiality` (ignored). See [Compatibility](https://www.usetidepool.tech/docs/resources/compatibility) and the [Roadmap](https://www.usetidepool.tech/docs/resources/roadmap).

Re-run any time with `npm run conformance`.
