# LINE bot

Three Lambdas, one migration, and a console page on the admin dashboard.

**Provisioned and live as of 2026-09-10**, against the LINE Official Account
**Titanium Initium** (`@025gtozl`). The three functions exist, migration `017` is
applied, and the webhook is reachable and enforcing signatures.

**One step is left and it needs a LINE console login:** set the webhook URL to

```
https://u91xzojfja.execute-api.ap-east-2.amazonaws.com/production/line/webhook
```

then enable "Use webhook" and **disable auto-reply messages**, or LINE's canned
replies race the bot's own.

### What the account can actually do

Probed 2026-09-10, and it is narrower than the plan tier suggests:

| | |
|---|---|
| Followers | **2** |
| Audience groups | **0** |
| Monthly quota | **200**, 4 used |

**Narrowcast is wired but will refuse.** It targets audience objects, there are
none, and LINE enforces a minimum recipient count that two followers cannot meet.
The console says so rather than offering a button that always fails. For a
handful of caregivers **multicast is the right primitive**.

**The 200/month quota is the real constraint** — every push, multicast and
broadcast counts, replies do not. That is why the webhook replies wherever it can.

---

## Why three functions

The same reason escalation is two and the telemetry rollup is two. `api.line.me`
is on the internet, RDS is private, and this account has **no NAT gateway and no
interface endpoints** — so a VPC-attached Lambda reaches the database and nothing
else, while one outside reaches every API and not the database. Verified
2026-07-31, recorded in `PLAN.md` §0.6.

| Function | VPC | Reaches | Job |
|---|---|---|---|
| `tish-line-webhook` | **no** | LINE | Public entrance. Verify signature, dedupe, route. |
| `tish-line-send` | **no** | LINE, Lambda API | Every outbound call. Owns the channel token. |
| `tish-line-db` | **yes** | RDS | Every row in migration `017`. |

`tish-line-webhook` and `tish-line-send` invoke `tish-line-db` through the Lambda
API — the direction that works without buying anything, since a non-VPC function
can call the Lambda API freely and the reverse would need an interface endpoint.

**Separate `package.json` per function, and the split is load-bearing.** The
webhook has no database client and never should; one shared manifest would ship
`pg` into its zip whether it imported it or not. Same argument as
`telemetry/ingest` — it makes the guarantee structural rather than a comment.

## The webhook is a router, not a brain

It verifies, dedupes, decides who handles the event, and returns 200. Nothing
slow belongs in it: **LINE retries on a timeout**, so a handler that waits on
something expensive turns one inbound message into several.

When the LLM arrives it goes behind a queue as a separate consumer and this file
does not change. That is the whole reason it is shaped this way now — it costs
nothing today and saves the rewrite later.

## Three things that will bite

**The signature is over the raw body, byte for byte.** Parsing and
re-stringifying changes whitespace and every signature then fails — a failure
that looks like a wrong secret and is not. `rawBodyOf` handles the gateway's
base64 form; do not "simplify" it into `JSON.parse`.

**LINE retries.** Any non-200, or a response slower than its timeout, and the
same delivery arrives again. `line_events` dedupes on `webhookEventId`, and the
handler returns 200 even when an individual event throws — a non-200 would
replay the whole batch including the events that already succeeded.

**Narrowcast is asynchronous, and a 202 is not a delivery.** It returns a request
id you poll through `narrowcast-progress`. It also enforces a minimum audience
size, so for a handful of caregivers **multicast is the right primitive** and
narrowcast will simply refuse.

---

## Wiring — done 2026-09-10, kept as the record of what was created

### 1. Apply the migration ✅ — seventeen applied, none pending

`017_line_bot.sql` creates `line_accounts`, `line_link_codes`, `line_events`,
`line_messages` and `line_outbox`.

**Deploy the runner before the handler**, as with `016`: build a zip of
`migrate.mjs migrations package.json node_modules` — deliberately **without**
`index.mjs` — and deploy it to `tish-migrate` alone, then apply. CI builds one
artifact for every backend function, so pushing normally would ship handler code
alongside a migration that has not run.

`zip` is not installed on this machine; `py/.venv` has a real Python and
`python -m zipfile -c` produces the forward-slash entries Lambda requires.

### 2. Create the functions ✅ — all three Active, sharing `operation-strix-role-8wrlapsc`

All `nodejs24.x`. `tish-line-db` needs the VPC config and security group that
`tish-escalate-db` uses; the other two must **not** be VPC-attached.

| Function | Env |
|---|---|
| `tish-line-webhook` | `LINE_CHANNEL_SECRET`, `LINE_DB_FUNCTION`, `LINE_SEND_FUNCTION` |
| `tish-line-send` | `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_DB_FUNCTION` |
| `tish-line-db` | `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |

**The channel token lives on `tish-line-send` and nowhere else.** The admin API
invokes that function rather than calling LINE itself, so the console cannot send
by a route the product does not also use — and the dashboard Lambda never holds a
credential it could leak.

### 3. IAM ✅ — `LineInvokeHalves` on the shared role, `InvokeLineSend` on `tish-admin-translations-role`, and all three functions added to `github-lambda-deploy`

Two grants, and the second is the one that was forgotten last time:

- `tish-line-webhook` and `tish-line-send` need `lambda:InvokeFunction` on
  `tish-line-db`; `tish-admin-translations` needs it on `tish-line-send`.
- **Add all three new functions to `github-lambda-deploy`'s allowlist.** That
  role carries an explicit per-function list for `lambda:UpdateFunctionCode`, and
  a name in a deploy loop that is missing from the policy fails *after* earlier
  functions have already shipped — half the deploy applied, the run red.

### 4. The gateway route ✅ — `/line/webhook` on `TISCv1` (auth NONE), and the four `/line/*` admin routes split across the two integrations

`POST /line/webhook` on `TISCv1`, **`--authorization-type NONE`**, integrated
with `tish-line-webhook`.

⚠ **It must be its own resource.** `TISCv1` routes everything to the VPC-attached
`operation-strix` via a root `/{proxy+}`, so without an explicit resource the
webhook falls through to a Lambda that cannot answer LINE. Adding a route is two
places, and forgetting the second fails in a way that looks like LINE being
broken.

The admin API's `/line/*` routes need resources too, and they split across the
two integrations: `/line/send` and `/line/status` on the **non-VPC**
`tish-admin-translations`, `/line/log` and `/line/recipients` on the **VPC**
`tish-admin-api`.

### 5. The LINE console ⬅ **the one step left**

Set the webhook URL, enable "Use webhook", and disable auto-reply messages —
otherwise LINE's canned replies race the bot's own.

---

## Testing without deploying

```bash
cd line/webhook && npm test     # 15 tests, signature and routing
cd line/send    && npm test     # 11 tests, the logging contract
```

Neither needs credentials or a network; the fetch and the invoker are injected.

For the dashboard console against fixtures — including a failed send and a stuck
row, which are the states worth looking at:

```bash
npm run dev --prefix dashboard -- --mode mock
```

## What is not built

- **The LLM reply.** The webhook answers conversation with an honest holding
  message. See the note above about where the brain goes.
- **The outbox drain.** `line_outbox` is created and the console reads it, but
  nothing writes to or drains it yet — that arrives with the first product event
  that needs to reach LINE, most likely the SMS escalation rung that currently
  substitutes to a duplicate caregiver push.
- **Link-code issuing.** `line_link_codes` is redeemed by the webhook but no
  route issues one yet; that belongs on the patient backend, behind Cognito.
