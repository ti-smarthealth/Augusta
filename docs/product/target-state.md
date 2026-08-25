# Tish — product definition, **v2: every plan implemented**

**The same product, with every plan currently written down in this repository
carried out.** Its companion is [`current-state.md`](current-state.md), which
describes what exists today; the two files are written section-for-section so
they can be read side by side, and the delta is tabulated at the end.

**This is bounded by the plans that exist, not by ambition.** Everything here
traces to a numbered item, a decision, or a node on the target architecture
diagram — nothing has been invented to round the picture out. Where a plan is
referenced but absent from the repository, that is called out rather than
guessed at. Provenance and revision procedure: [`README.md`](README.md).

---

## In one paragraph

Tish is a bespoke, bilingual mobile and web application that gives elderly
patients and their caregivers a shared platform for medication adherence,
including alarm-grade dose reminders that survive a silenced phone, appointment
and test-result tracking, and comes with an integrated pipeline for missed-dose
detection, two-channel caregiver escalation, and adherence reporting.

*The only words that change from v1 are the ones this document has to earn:
**that survive a silenced phone**, and **two-channel**. ("And web" was on this
list until 2026-08-25, when the web site shipped.)*

## Who it is for

Unchanged. Patients, caregivers, and company staff — with two reach changes:

| Audience | What is different |
| --- | --- |
| **Patients** | Unchanged in reach — the browser surface landed 2026-08-25 |
| **Caregivers** | A second escalation channel that does not depend on their having the app installed and push permitted |
| **Staff** | Unchanged in scope, but an on-call inbox means a failing escalation sweep reaches a person instead of waiting to be noticed on a dashboard |

Still **no clinician-facing surface**, and still no integration with any
hospital system. That is a product boundary, not an unfinished edge.

## The problem it solves

Unchanged, and the two halves are the same. What changes is that both are
finally *demonstrated* rather than argued:

1. **Audibility** — verified on physical hardware, and reaching through Focus
   modes; optionally through ring-silent and Do Not Disturb as well, if Apple
   grants the Critical Alerts entitlement.
2. **A second person** — reached over two genuinely independent channels, push
   and SMS, rather than one channel used twice.

## Surfaces

| Surface | What changes |
| --- | --- |
| **Patient app** | Verified on a physical device and shipping through TestFlight without a manual provisioning intervention. Android reaches parity: exact alarms declared to the Play Console, alarm-stream channel audibility, and its own E2E job |
| **Patient web site** | Unchanged — shipped 2026-08-25 |
| **Admin dashboard** | Unchanged in shape. Purpose-built screens are added only where Metabase has been shown not to answer the question |
| **BI** | Unchanged — Metabase over both stores, still the default answer before any screen is written |
| **On-call inbox** | **New.** The alert topic gains a subscriber, so a firing alarm reaches somebody without anybody opening a page |

## Capabilities

Everything in v1 holds. What follows is what is added or completed.

### Identity and delegated access

| Capability | What changes |
| --- | --- |
| Verification codes | **SMS becomes available** at sign-up as a delivery choice, and is the product's preferred medium. Requires exiting the SNS sandbox *and* restoring `phone_number` to the pool's auto-verified attributes — two changes, not one |
| Phone numbers | Verified rather than merely stored, which is the precondition for ever texting a patient anything |
| Email | Sent from the company's own domain through SES production access, with SPF and DMARC in place, instead of Cognito's default sender |
| Access model | Unchanged. Whether a caregiver's ability to switch off a patient's safety net stays symmetric is an **open decision**, with visibility — showing each party the other's changes — as the recorded first step rather than restriction |

### Medication and reminders

| Capability | What changes |
| --- | --- |
| Alarms | Proven on hardware end to end: bundled sounds, the burst firing as a burst, tray dismissal on response, snooze alarms actually firing, and the seven-day horizon accepted by the operating system |
| Interruption level | Time-sensitive today; **ring-silent and Do Not Disturb** as well, if the Critical Alerts entitlement is granted. Filed opportunistically — it is one flag, one entitlement and a build, and it blocks nothing |
| Android | Exact alarms declared to the Play Console under the alarms-and-timers policy, with the fallback path decided in advance if the declaration is refused |
| Non-daily reminders | Materialisation anchors on a stored start date, so a reminder that repeats every three days keeps its phase instead of drifting |
| Missed doses | The seven-day list stops truncating silently at twenty entries |
| Snooze consistency | The device's caregiver copy follows a snooze the way the server already does, ending the one place where the two disagree and a caregiver can be alerted twice |

### Escalation

| Capability | What changes |
| --- | --- |
| Channels | **The SMS rung sends.** The ladder becomes two genuinely independent channels — a caregiver push and a text to the patient — rather than one channel twice. The order remains configurable per medication |
| Delivery evidence | The receipt poll has real receipts to read, so a dead device is detected on a delayed failure and not only a synchronous one |
| Alerting on itself | The escalation sweep's own alarms reach an on-call inbox. Today they publish to a topic with no subscribers, which means a sweep that fails every minute for a fortnight is visible only to somebody who happens to look |

### The rest of the record

Unchanged. Appointments, test results and announcements are complete as built;
no plan in the repository extends them.

### Language and accessibility

| Capability | What changes |
| --- | --- |
| Locale coverage | The parity check runs on any change that could introduce a key, not only on changes to the locale files themselves — closing the gap where a new string in code touches no locale path and ships as a raw key |
| Everything else | Unchanged |

### Staff dashboard and measurement

| Capability | What changes |
| --- | --- |
| Views | Only what Metabase demonstrably cannot answer gets hard-coded. The cohort overview was cut on exactly this argument and stays cut |
| Routing rule | Unchanged and load-bearing: care facts to Postgres, product analytics to S3/Athena. Every future metric is routed by it, which is the point — "we want to track X too" never reopens the design |

## Security posture

**This is the largest single difference between v1 and v2, and it is the one
section written against a plan that does not exist as a file.** The individual
findings are recorded across `PLAN.md`, `MIGRATION.md` and
`dashboard/AWS-SETUP.md`, each explicitly deferred to a security effort that is
named everywhere and written down nowhere. Treat the list below as the union of
those findings, and expect the real plan to supersede it.

| Finding | Target state |
| --- | --- |
| Destructive and data-dump routes sit above the auth guard | Behind authentication, or gone. `/reset-db`, `/seed-data` and the table dumps are unauthenticated today by deliberate choice, tolerable only while data is disposable |
| Database credentials in plaintext Lambda environment variables | Secrets Manager, in both the app backend and the admin API |
| The Lambda connects as the RDS master user | A least-privilege role — read-only where the function only reads |
| The database connection is encrypted but unauthenticated | Certificate verification on |
| The deploy role trusts any repository in the account, on any ref | Narrowed to the repositories and branches the documentation already claims |
| Data disposability | Retired. Application data stops being rebuildable-by-default the moment a real patient exists, which also retires the reset route as a routine tool |

## What the product deliberately does not do

Unchanged from v1, and worth restating because a completed product invites
each of them again:

- **No push reminder to the patient at dose time**, even once push is fully
  proven. This was decided, not skipped.
- **No replay of missed doses.**
- **No Android burst, and no full-screen alarm activity** — revisitable only
  against the conditions written into the spike that declined it.
- **No third-party analytics SaaS**, on residency grounds that geography does
  not relax.
- **No hospital-system integration, and no clinician surface.**

## Operating context

- Still one region, `ap-east-2`, with Seoul for mail and Cognito unmoved.
- Still no NAT gateway and no VPC endpoints — the split-Lambda pattern stays,
  because paying monthly to remove it has been declined more than once.
- **Every deployable is deployed by CI**, including the two escalation Lambdas
  that are hand-built today. Applying a migration stays a deliberate manual act,
  by design.
- **E2E runs in CI on both platforms**, on a funding route that has been chosen
  — a public repository, paid Actions minutes, or a paid EAS plan. Android is
  unparked, and the flow set includes one that proves an alarm actually fires,
  which is the highest-risk silent failure in the product and the original
  reason the E2E tool was chosen.
- **Component and hook tests exist** alongside the current dependency-free unit
  suites, via jest-expo — accepted as an ongoing cost, since the harness pins to
  the Expo SDK and must be carried through every bump.

## Delta from v1, and where each line comes from

| Change | Source |
| --- | --- |
| Alarm engine verified on hardware; TestFlight build succeeding | `PLAN.md` §0.3 session-10 directive, §0.7 item 2b; `REBUILD.md`; `HANDOFF.md` |
| SMS escalation rung sends | `PLAN.md` 5.5 (blocked on Track B) |
| SMS verification at sign-up | `MIGRATION.md` Track B; `constants/config.ts` |
| Custom-domain email, SPF + DMARC | `MIGRATION.md` Track A |
| Critical Alerts entitlement (optional) | `PLAN.md` P0.2, 5.3 |
| Android exact-alarm Play declaration; Android E2E unparked | `PLAN.md` §0.7 item 5; `HANDOFF.md` |
| An E2E flow proving an alarm fires | `HANDOFF.md` "Next" |
| On-call inbox subscribed to the alert topic | `docs/architecture` target diagram (`oncall`); `alarms.sh`; the dashboard Health page |
| Security posture | `PLAN.md` P0.1; `MIGRATION.md` D2, D5; `dashboard/AWS-SETUP.md` "Known gaps" — **no plan file exists** |
| Anchor date for non-daily materialisation | `PLAN.md` §0.6 |
| Device snooze follows the server's re-anchoring | `PLAN.md` §0.3 "smaller things" |
| Missed-dose list stops truncating at twenty | `PLAN.md` §0.3 "smaller things" |
| Escalation Lambdas deployed by CI | `tish-app/backend/DEPLOY.md` |
| Locale check triggers on any change that could add a key | `MIGRATION.md` D6 — recorded, and **deliberately left alone** for now, because widening the trigger also changes what gets published and when |
| Component and hook tests | `PLAN.md` §0.8 |

## What is *not* in here, deliberately

- **Anything the repository does not plan.** No new clinical features, no
  integrations, no monetisation, no second market. If a stakeholder expects one
  of those in the target state, it is missing from the plans, not from this
  document.
- **The security plan's actual contents.** See the note above the security
  table.
- **Dates.** Every remaining item is gated on a decision, an external approval,
  or a person with an Apple or AWS login — not on engineering time, which is why
  the sequencing in `PLAN.md` §11 stopped being predictive.
