# LAB real LINE binding using the existing production Official Account (draft, disabled)

## Safety boundary
The production LINE Official Account is shared. Its Messaging API webhook URL must remain unchanged. A production-channel event must never be forwarded to the LAB by merely changing LINE Developers settings.

The existing production webhook currently interprets `#綁定帳號 123456` against the production binding table. **Do not send a LAB code using this command**. The separate LAB simulation endpoint is not a real LINE webhook.

## Proposed opt-in relay (not enabled or deployed)
1. A verified LINE webhook receives a one-to-one message beginning with `#LAB綁定`. All normal commands continue unchanged.
2. Check an exact allowlist of LINE user IDs, plus a short-lived test window. Default off; unknown users are never forwarded. Do not log LINE user IDs, tokens or codes in plain text.
3. Forward only the minimal signed test payload over HTTPS to an allowlisted LAB API origin using a separate shared secret, timestamp, nonce and replay protection. The relay must reject arbitrary URLs and fail closed.
4. The LAB verifies the relay signature, freshness, replay protection, tenant, parent identity, binding-code expiry and one-time use. It uses LAB-only Azure Storage. Production storage is never queried or written by the test route.
5. Reply with a short, non-sensitive LAB-only confirmation. The production LINE channel token is used solely by the production reply handler; LAB must never receive that token or issue LINE API requests.
6. Provide an explicit kill switch and a TTL for the allowlist. Disable immediately after validation.

## Before any production rollout
- Confirm LAB Azure Storage account and LAB API origin are distinct from production.
- Confirm the specific test LINE user ID via an authenticated verification method, and pair it with one LAB-only parent account. Do not assume a display name identifies a user.
- Implement automated tests: disabled/default, allowlist miss, non-user source, wrong command, invalid relay signature, replay, expiry, duplicate binding, cross-tenant, wrong parent, LAB storage mismatch, no normal-command regression.
- Run LAB-only tests and review production webhook changes separately. Obtain explicit approval before deploying a production webhook relay.

## Current status
This is a design and safety checklist, **not** an operational relay. No production LINE settings, webhook, channel token or data have been changed.
