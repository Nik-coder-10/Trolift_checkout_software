# Monitoring & alerting — what to watch and how, without paid infra

## What already exists (verified in code)

1. **`GET /api/health`** — liveness: `{ status: "ok" }`, no DB call.
   Cheap enough for 10-second external polling.
2. **`GET /api/ready`** — readiness: bounded DB probe (single-row,
   3 s race timeout, 10 s result cache, own rate-limit bucket) plus
   the **production configuration checks** (UPI id, invoice identity,
   Supabase credentials, shared rate-limit backend — see
   lib/config/production.ts). In production, missing critical config
   or an unreachable database ⇒ **503**. This is the single best
   alert source: point a free external uptime checker at it.
3. **Structured JSON logs** (`lib/observability/logger.ts`): every
   API request logs `API <method> <route> <status>` with duration,
   `requestId`, and `errorCategory`; severity escalates automatically
   (≥500 → `error`, ≥400 → `warn`). Unhandled exceptions log
   `Unhandled route error` with the category + reference id. A fixed
   redaction list keeps tokens/keys/cookies out of every line.
4. **Correlation ids**: `x-request-id` is echoed on every response,
   so a support complaint maps to exact log lines.

## Alertable log signals (by failure class)

Alert on the presence/rate of these `message` values in the platform
log stream (host log drain, or a one-line `grep | while read` cron
mailer — no paid service required):

| Failure class | Signal to alert on |
| --- | --- |
| Order creation failures | `API POST /api/orders` with `statusCode` ≥ 500, or `Unhandled route error` with `route` = `/api/orders`. A burst means checkout is broken — page immediately. |
| Database connectivity failures | `Readiness probe: database query failed.` or any `/api/ready` returning 503 — page immediately. |
| Payment verification failures | `API POST /api/payments/claim` with statusCode ≥ 500 (infrastructure failure — page). Rate of 4xx here is expected customer error; watch only 5xx. Claim rejections at 4xx are logged normally and must NOT page. |
| Invoice generation failures | `API GET /api/orders/{id}/invoice` or `/api/admin/orders/{id}/invoice` with statusCode ≥ 500 (often a misconfiguration — the readiness config checks catch the common cause before an order hits it). |
| Shared rate-limit backend outages | `Rate-limit backend unavailable: rejecting mutation.` (page: mutations are being rejected) and `Rate-limit backend unavailable: allowing read (degraded).` (warn). Also `Rate limiting without a shared store in production.` at boot — a misconfiguration, fix before an incident finds it. |
| Failed migrations | Not emitted at runtime (migrations run via CLI). The gate is process: migrations.md steps 1–7; after any push, watch for a spike in the two signals above plus `Unhandled route error` across all routes. |
| Unexpected API error increases | Alert threshold on the log stream itself: `level=error` count per 5-minute window above the normal baseline (start with: any sustained `error` for 5 min, or >10 errors in 5 min). Every 5xx is already logged at `error` level by the shared handler. |

## Recommended free-tier wiring

- **Uptime**: any free external checker (UptimeRobot, Better Stack
  free tier, GitHub's own cron action hitting `/api/ready`) polling
  `/api/ready` every 1–5 minutes. 503 = page. Do not poll
  `/api/health` alone — it cannot see the database or config.
- **Error-rate alert**: if the host offers log-based alerts (Vercel
  logs, Grafana free tier), alert on `level":"error` frequency. If
  not, a tiny scheduled job grepping the log drain for the table
  above and emailing the operator is sufficient at this scale.
- **Admin triage surface**: the admin command center shows live
  order/payment/shipment state — it doubles as the "is this a real
  incident or one order?" check once an alert fires.

## `ADMIN_ALERT_EMAIL` — resolved: REMOVED

`.env.example` previously listed `ADMIN_ALERT_EMAIL`, but no code
ever read it: implementing email sending would require an SMTP
provider or paid API (needless paid infrastructure for a
single-operator store), and leaving a documented-but-dead knob is
worse than none — an operator would reasonably believe alerts were
being sent. It has been **removed from `.env.example`** and the
intended behaviour is documented here instead: alerting is
log-signature based, delivered by the external uptime/error checks
above to whatever channel the operator actually reads. If email
alerting is wanted later, implement it against a real provider in
one place and re-add the variable then — with a test.
