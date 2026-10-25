# Public demo through judging

The hosted demo link is withheld pending additional security work. This runbook
covers planned judging availability through December 15, 2026. The hardening
branch was started independently from `origin/main` at `30accf3`, then rebased
onto main after Nemotron PR #14 merged. Deployment includes Nemotron role/usage instrumentation and the hardening limits below.

## What was happening

An offline probe of the original server at `30accf3` used a counting fake LLM
and fake token provider, so the investigation incurred no provider charges.
Closing the only WebSocket left the room `presenting`: calls increased from
6 at disconnect to 16 after another 2.2 seconds (one-second test ticks).
All 12 STT-token requests returned 200 and reached the provider. Sessions
had no eviction and `/health` only exposed the registry size. The matching
hardened probe stopped at 6 calls, kept its report available, and allowed only
10 of 12 token attempts to reach the fake provider. See the
[before/after evidence](evidence/demo-hardening-before-after.json); the probe
shortens the grace period while deterministic checks cover production defaults.

## Limits and cleanup

| Environment variable | Default | Behavior |
|---|---:|---|
| `FRONTROW_IDLE_END_SECONDS` | 60 | End after the last WebSocket disconnects, including rooms that never connect |
| `FRONTROW_MAX_SESSION_SECONDS` | 1200 | End at this age from creation, even while connected |
| `FRONTROW_SESSION_RETENTION_SECONDS` | 3600 | Retain the report, replay, and audio after ending; then remove the room |
| `FRONTROW_MAX_LIVE_SESSIONS` | 20 | Cap idle, presenting, and Q&A rooms together; excess creation returns 503 |
| `FRONTROW_SESSIONS_PER_IP_PER_HOUR` | 6 | Shared rolling-hour allowance for JSON and PDF session creation |
| `FRONTROW_STT_TOKENS_PER_SESSION` | 10 | Token issuance attempts, including uncertain/failed provider responses |
| `FRONTROW_MAX_SESSIONS_PER_DAY` | 150 | Global admission allowance, reset at midnight UTC |

The maintenance scanner runs every second. Reconnecting during the disconnect
grace period keeps a room alive; one remaining WebSocket also keeps it alive.
A connected silent tab still reaches the creation-age limit. Automatic ending
stops listener, summary, answer-judging, and speech tasks, then exposes the
ordinary report using accepted transcript and completed results. It does not
launch a final model request after the cutoff. Normal presenter-driven ending
keeps its usual closing tick and answer judging.

Admission reservations happen before upload awaits. Invalid uploads and failed
creation release their reservation. PDF reading/extraction is serialized, and
extraction runs in a thread so it does not block cleanup or `/health`. Cancelling
an upload refunds its admission while its extraction keeps the single permit
until the running thread completes. Token attempts are reserved before calling
ElevenLabs and are never refunded: a timeout may still have minted a token.
HTTP 429 responses carry a human message and integer `Retry-After`; busy 503
responses also include a wait hint. The browser shows the message, does not
retry a quota refusal automatically, and keeps typed input usable when only
speech is refused. A token limit does not invalidate an already issued token
or impose a billed-minute limit on an existing ElevenLabs connection.

Reports, audio, events, and room metadata return 404 after retention expires.
The cleanup releases per-room SDK clients; shared injected clients remain open
until their final owner releases them. No session persistence is added.

`GET /health` now returns:

```json
{"ok": true, "sessions": 3, "live_sessions": 1, "retained_sessions": 2}
```

Keep **one uvicorn worker**, bound to `127.0.0.1`, behind Caddy. Only the exact
IPv4 loopback peer may supply `X-Forwarded-For`; other peers, including `::1`,
use their direct address. An invalid first forwarded address falls back to the
peer. The limiter is in memory, so restarts clear quotas and replicas would
multiply allowances. Shared school/Wi-Fi addresses share the hourly allowance.
Distributed traffic can exhaust the daily allowance; this is a usage bound,
not an authentication system or a guarantee of judge capacity during abuse.
Provider spending controls remain necessary.

## Verification

```bash
cd apps/api
uv run python verify.py
cd ../../frontend
npm run test:live
npm run build
```

`verify_demo_hardening.py` uses injected monotonic/UTC clocks, fake speech and
LLM providers, and no paid calls. It checks rolling-hour boundaries, midnight
UTC, trusted-proxy handling, JSON/PDF admission, simultaneous token requests,
provider-error accounting, reconnects, idle/max-age endings with reports,
retention, resource release, cancelled uploads, and cancellation of stalled
listener, closing-summary, and command waits.

The local [three-minute live check](evidence/demo-hardening-live-proof.json)
completed in 180.917 seconds with 18 typed lecture segments over the real
WebSocket, four raised hands, one real ElevenLabs audio fetch (86,560 bytes),
a `partial` answer verdict, and the normal report including teaching moves.
It minted a real Scribe v2 Realtime token; this scripted check did not record a
microphone. That initial check used Claude Haiku 5.5 before the Nemotron PR
merged. No fallback, listener/summary/judge, or audio errors were recorded. After rebasing onto merged PR #14, all **90 backend checks**, **86 frontend
tests**, and the production build passed. The added summary-context regression
checks that tracked tasks preserve the fast tier, summary role, and session
observer. A shared-client regression also verifies evicted sessions are
garbage-collected while fallback callbacks and active-session counters still work.
A [real Nemotron replay](evidence/demo-hardening-nebius-replay.json)
recorded **15 reaction requests and 3 summary requests** under `fast`, with
**0 fallbacks and 0 errors**. All 18 calls used Nano; this replay produced no
answer-grading calls. Nebius reported an estimated **$0.00081798** inference cost
at list prices, excluding voice and hosting. Deployment remains an owner step.

## Owner checklist after merge

Jaswanth chooses dollar/credit thresholds based on the available account balance,
measured session cost, anticipated traffic, and coverage through December 15.
Do not mark these steps complete until checked in the actual consoles. This PR
does not change billing, deploy the app, or create monitoring resources.

- [ ] **ElevenLabs:** open Developers → API Keys, edit the production key, and
  set a credit quota with only the speech scopes the app needs. Review the
  Subscription/Billing page for the account's PAYG or legacy usage-based billing
  settings; disable automatic credit purchases/overage if unwanted or set an
  available usage ceiling. Confirm the allowance covers November and the first
  half of December, and verify exactly when each quota resets. API-key credit
  limits and payment options vary by plan: [API keys](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys),
  [billing](https://elevenlabs.io/docs/overview/administration/billing).
- [ ] **Nebius:** confirm the production Token Factory project, remaining credits,
  expiration date, and payment behavior. Configure a budget and threshold email
  alerts in its billing console and confirm they include **Token Factory usage**.
  Nebius documents project budgets and alerts for AI Cloud; if the Token Factory
  account does not expose that control, confirm coverage with Nebius support
  rather than assuming a Cloud budget monitors it. An alert alone does not prove
  a hard stop. See [Nebius budgets announcement](https://nebius.com/blog/posts/ai-cloud-aether-3-6).
- [ ] **Google Cloud:** verify the billing account, credit expiry, and funds cover
  the e2-small VM, disk, static IP, and network through December 15. Create a
  project budget with actual/forecast email thresholds below the available
  balance. Ordinary [budget alerts](https://docs.cloud.google.com/billing/docs/how-to/budgets)
  do not stop charges. Google's [spend cap budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps)
  apply only to eligible API services and do not pause this persistent VM's
  ongoing compute/storage costs.
- [ ] **Uptime:** add a free HTTPS check for
  `/health` on the privately configured deployment origin, expect 200 and
  `ok: true`, and attach an email alert policy for the team. Send a test alert and confirm receipt.
  Review the selected check's current free allowance before creating it.
- [ ] **Deployment:** after both PRs merge, run `infra/gcp/deploy.sh` from the
  merged committed checkout. Preserve `FRONTROW_MODERATOR_WARMUP_SECONDS=15`
  and `FRONTROW_MODERATOR_WARMUP_MIN_WORDS=25` in the VM's `.env`. Do not push a
  local `.env` over the VM's without reviewing those values and production keys.
- [ ] **Public smoke:** check `/health`, run a three-minute session with captions,
  a spoken question, an answer, and its report; close another presenting tab
  and confirm it ends after the disconnect grace period. Confirm the team
  knows the quota messages, report retention window, and deployment restart behavior.
