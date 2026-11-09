# LAB real LINE binding using the existing production Official Account (draft, disabled)

## Safety boundary
The production LINE Official Account is shared. Its Messaging API webhook URL must remain unchanged. A production-channel event must never be forwarded to the LAB by merely changing LINE Developers settings.

The existing production webhook currently interprets `#綁定帳號 123456` against the production binding table. **Do not send a LAB code using this command**. The separate LAB simulation endpoint is not a real LINE webhook.

## Proposed opt-in relay (not enabled or deployed)
1. A verified LINE webhook receives a one-to-one message beginning with `#LAB綁定`. All normal commands continue unchanged.
2. Check an exact allowlist of LINE user IDs, with a persistent but revocable LAB tester authorization. Default off; unknown users are never forwarded. Authorization does not expire after one test, while binding codes remain short-lived and single-use. Do not log LINE user IDs, tokens or codes in plain text.
3. Forward only the minimal signed test payload over HTTPS to an allowlisted LAB API origin using a separate shared secret, timestamp, nonce and replay protection. The relay must reject arbitrary URLs and fail closed.
4. The LAB verifies the relay signature, freshness, replay protection, tenant, parent identity, binding-code expiry and one-time use. It uses LAB-only Azure Storage. Production storage is never queried or written by the test route.
5. Reply with a short, non-sensitive LAB-only confirmation. The production LINE channel token is used solely by the production reply handler; LAB must never receive that token or issue LINE API requests.
6. Provide an explicit kill switch for the allowlist, plus a manual disable control. Persistent authorization must not imply perpetual exposure of the relay. Disable immediately after validation.

## Before any production rollout
- Confirm LAB Azure Storage account and LAB API origin are distinct from production.
- Confirm the specific test LINE user ID via an authenticated verification method once, and pair it with one LAB-only parent account. The public LINE ID `roy.lin` is not the Messaging API user ID and must not be used as an allowlist key. Do not assume a display name identifies a user.
- Implement automated tests: disabled/default, allowlist miss, non-user source, wrong command, invalid relay signature, replay, expiry, duplicate binding, cross-tenant, wrong parent, LAB storage mismatch, no normal-command regression.
- Run LAB-only tests and review production webhook changes separately. Obtain explicit approval before deploying a production webhook relay.

## Current status
This is a design and safety checklist, **not** an operational relay. No production LINE settings, webhook, channel token or data have been changed.

## Updated product requirement: first-time parent onboarding (2026-11-09)
The intended UAT begins with a parent who has **not yet followed** the existing Official Account. From the authenticated parent portal, provide one coherent flow: start LINE connection, authorize via LINE Login with the add-friend option, return to the portal, confirm verified identity, and display binding/friendship status. The parent must not manually retrieve a Messaging API user ID or paste a binding command.

This requires a LINE Login channel and verified server-side OAuth callback (state, nonce, PKCE where supported, token verification, redirect URI allowlist) under the **same LINE Developers provider** as the existing Messaging API channel for user ID correspondence. LINE friend-add is user-controlled; distinguish followed, blocked and unknown status. Never claim successful follow solely because the add-friend screen was opened. Use a backend-verified identity and LAB-only parent/session/tenant authorization before writing the LAB binding. Protect against account takeover and replay. Keep secrets in environment settings, never frontend JS.

The shared production Official Account must retain its existing webhook and notification flow. This design replaces the earlier manual #LAB command as the preferred onboarding UX; the draft diagnostic commands remain disabled and must not be advertised to parents. Do not deploy or enable anything in production before verifying provider/channel configuration, redirect URIs and isolation, and approving the minimal changes.

## Confirmed LAB origin and planned callback (2026-11-09)
- User-confirmed isolated Functional UAT LAB origin: `https://icy-ocean-0a2602100.6.azurestaticapps.net`.
- Planned exact LINE Login redirect URI: `https://icy-ocean-0a2602100.6.azurestaticapps.net/api/line/login/callback`.
- LINE Login Channel ID: `2012482463` (public identifier, not a secret).
- Provider: 聖心弦樂團家長服務台; linked Official Account selected: 聖心弦樂成長平台.
- **This callback route is not yet implemented or deployed.** Do not begin end-to-end login or assume that entering the URL in LINE Developers activates it.
- LAB-only environment variables to provision securely after implementation: LINE_LOGIN_CHANNEL_ID, LINE_LOGIN_CHANNEL_SECRET, LINE_LOGIN_REDIRECT_URI. Do not reuse production Messaging API secrets or expose them to the browser.
- Before enablement: implement state/nonce persistence and one-time use, token exchange and ID token verification, server-side linkage to an authenticated LAB parent, CSRF and session-binding protections, friendship check, safe redirect and failure recovery; test callback and isolation.
