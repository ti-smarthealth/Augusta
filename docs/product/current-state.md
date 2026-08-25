# Tish — product definition, **v1: as built**

**State of the repository on 2026-08-25.** This describes what exists and runs
today, not what is intended. Its companion is [`target-state.md`](target-state.md),
which describes the same product with every plan in this repository carried out;
the two files are written section-for-section so they can be read side by side.

Provenance, and how to revise this without re-reading the whole repository:
[`README.md`](README.md).

---

## In one paragraph

Tish is a bespoke, bilingual mobile and web application that gives elderly
patients and their caregivers a shared platform for medication adherence,
including alarm-grade dose reminders, appointment and test-result tracking, and
comes with an integrated pipeline for missed-dose detection, caregiver
escalation, and adherence reporting.

## Who it is for

| Audience | What they do with it |
| --- | --- |
| **Patients** — older adults in Taiwan managing a long-term condition | Keep a medication schedule that alarms audibly, confirm doses, see appointments and lab results, read clinic announcements |
| **Caregivers** — usually a family member, sometimes remote | Hold delegated access to a patient's records, edit their schedule, and receive an alert when a dose goes unconfirmed |
| **Clinic and company staff** | Publish announcements, maintain translations, inspect the database, watch adherence and operational health from a web dashboard |

There is **no clinician-facing surface**. Nothing in the product writes to or
reads from a hospital system, and no professional record-keeping obligation is
assumed anywhere in it.

## The problem it solves

A dose reminder that does not wake the person is not a reminder, and a patient
who misses one leaves no trace for anybody who could help. Tish attacks both
halves:

1. **Audibility** — the reminder has to survive a phone in a pocket, a Focus
   mode, and an app that has not been opened in days.
2. **A second person** — when the patient does not respond, somebody who cares
   about them finds out, without the patient having to ask.

Everything else in the product — appointments, results, announcements — exists
because the same person is already opening the app for their medication and has
nowhere better to keep them.

## Surfaces

| Surface | What it is | Where it runs |
| --- | --- | --- |
| **Patient app** | Expo / React Native, expo-router, react-native-paper. iOS is the shipping target; Android and web build from the same tree | TestFlight (`com.ti-smarthealth.app`) |
| **Patient web site** | The same app's static web export — same API, same Cognito pool. Reading and editing from a browser; the alarm engine stays native-only | <https://app.ti-smarthealth.com> (Amplify Hosting) |
| **Admin dashboard** | React 19 + Vite SPA, shadcn/ui, TanStack Query/Table | <https://admin.ti-smarthealth.com> (Amplify Hosting) |
| **BI** | Metabase over both data stores, no bespoke code | <https://bi.ti-smarthealth.com> (EC2, startable and stoppable from the dashboard) |

## Capabilities

### Identity and delegated access

| Capability | Detail |
| --- | --- |
| Accounts | Cognito user pool (patients) — sign-up, sign-in, confirmation code by **email**, password reset, email verification from the profile screen |
| Profile | Name, birth date, gender, condition, contact details, per-user meal times, timezone and locale |
| Caregiver links | Request access by identifier, confirmed by a handshake code the other party enters; accept or deny; a stored relationship type that renders as a translated label |
| Revocation | Either participant can revoke; the row survives revocation as the record that access was once held; re-linking clears it |
| Scope switching | A caregiver picks which patient they are acting for; the choice persists across launches and is revalidated against the server |
| Enforcement | Every route resolves access server-side; a revoked caregiver's device is told to drop the alarms it is holding |

### Medication and reminders

| Capability | Detail |
| --- | --- |
| Medication library | Shared, searchable, extendable, with a default dosage per entry |
| Reminders | Per-medication dosage, clock times **or** meal-relative times resolved against that patient's own meal times, frequency in days, active/inactive |
| Alarm shape, per reminder | Sound choice, burst count (1–6 consecutive alerts, iOS), snooze length, escalation on/off, escalation delay, escalation order |
| On-device alarms | Up to a **seven-day horizon** laid out inside iOS's pending-notification budget, with a documented degradation ladder — audibility before horizon, a floor of two days, then dependants' copies dropped furthest-dose-first — and every degradation reported rather than silent |
| Response handling | An alarm overlay with looping audio, confirm or snooze; any response cancels the rest of the burst across **both** the scheduled and the delivered queues |
| Offline | Dose confirmations queue on the device and replay naming their dose explicitly, so a replay cannot land on the wrong one |
| Caregiver redundancy | A caregiver's phone also alarms for a dependant's dose — delayed, escalation-gated, and skipped if the dose is already confirmed |
| Missed doses | A seven-day in-app list. Missed doses are **never replayed as alarms** |

### Escalation

A scheduled job sweeps every minute and is the only thing in the system that
acts without a person triggering it.

| Capability | Detail |
| --- | --- |
| Claim | Overdue unconfirmed doses are claimed under `FOR UPDATE ... SKIP LOCKED`, incrementing the escalation level in the same statement |
| Ladder | Two rungs, per-medication order (caregiver-first or SMS-first), each rung one delay apart |
| Snooze | A snooze re-anchors the clock — the patient is demonstrably awake — with a circuit-breaker at three snoozes, after which escalation fires regardless |
| Channels | Expo push to the caregiver's devices. **The SMS rung has no transport yet** and substitutes to a caregiver push, so the ladder is effectively one channel twice |
| Hygiene | A lateness floor, dead-token reaping, and a delivery-receipt poll that catches tokens which fail late rather than synchronously |
| Silent push | Schedule changes, deletions and access revocations reach the device within about a minute, through an outbox drained by a non-VPC dispatcher |

### The rest of the record

| Capability | Detail |
| --- | --- |
| Appointments | Date and time, hospital, department, room, doctor, appointment number, status; read aloud on request |
| Test results | Up to 30 numeric fields whose display names, units and descriptions are configured centrally; entry form and line charts over time |
| Announcements | Localised articles with staff-managed categories, drafts and publish state; list and detail screens in the app |

### Language and accessibility

| Capability | Detail |
| --- | --- |
| Bilingual | English and Traditional Chinese, **426 keys**, parity enforced in CI; `t()` is typed against the generated key union, so a key missing from both files is a compile error |
| Language before sign-in | A toggle on the login, signup and password-reset screens, labelled in the language it switches *to* — the setting is reachable exactly where it is first needed, and persists into the app |
| Server-side language | The server renders push copy in that user's stored locale, not a global constant |
| Screen readers | An accessible name on every control, headings marked for rotor navigation, and `accessibilityLanguage` telling VoiceOver which language a label is written in — the app's language is independent of the device's, and dates and times format in the app's locale, not the phone's |
| Voice | Text-to-speech readouts for appointments and announcements; voice dictation into form fields |
| Errors | The API answers a failure with a stable machine code, which the app renders as a translated message; an unknown code falls back on the HTTP status, so a client build older than the server still says something sensible |

### Staff dashboard

| Capability | Detail |
| --- | --- |
| Access | Staff self-register with a company-domain address (enforced by a Cognito pre-sign-up trigger) and then wait for an administrator to add them to an approval group — group membership, not account existence, is the grant |
| Database | Read-only table viewer |
| Translations | Locale editor that commits changes straight back to this repository |
| News | Per-locale article authoring, publish state, and category management |
| Adherence | Patient list and per-patient drill-down over dose timing |
| Analytics | Daily app opens |
| Health | CloudWatch alarms discovered by naming convention, with an explicit warning when the alert topic has **no subscribers** |
| Cost control | Start and stop the BI server from the dashboard |

### Measurement

Two pipelines, split by a routing rule that is the actual design. **Care facts**
— when a dose was confirmed, how long after the alarm — go to Postgres, on the
row they describe. **Product analytics** — app opens — go to Firehose → S3 →
Athena, with a nightly rollup back into Postgres for the dashboard. Metabase
reads both.

## What the product deliberately does not do

Each of these was considered and declined; they are decisions, not gaps.

- **No push reminder to the patient at dose time.** Local notifications are the
  patient's only alarm channel. Push is for silent re-sync and for reaching the
  caregiver.
- **No replay of missed doses.** Take-late-versus-skip is drug-specific and
  needs clinical input the software does not have, so it does not guess.
- **No Android full-screen alarm activity, and no burst on Android.** The
  platform caps idle alarms at one per nine minutes, so a burst would degrade to
  a single alert exactly overnight, when it matters. Android audibility comes
  from an alarm-stream notification channel instead.
- **No third-party analytics SaaS.** Data stays in the company's own AWS
  account.
- **No hand-built cohort analytics** where Metabase already answers the question.

## Operating context

- **One region, `ap-east-2` (Taipei)**, except a Seoul SES identity for mail —
  Taipei has no SES endpoint. Cognito never moved, because a pool cannot be
  migrated between regions and every profile row keys on its `sub`.
- **RDS is private, and the VPC has no NAT gateway and no interface endpoints.**
  A Lambda inside the subnet reaches the database and nothing else; one outside
  reaches every AWS API and not the database. That single fact is why escalation
  and the telemetry rollup are each **two** Lambdas, and it is the first thing to
  understand before designing anything server-side.
- **Schema changes go through a VPC-attached migration runner** — twelve applied.
  Deploying the runner does not run anything; applying is a deliberate manual act.
- **CI deploys** the app backend, the migration runner, the admin API, the
  dashboard SPA, the patient web app, the Cognito trigger and the telemetry
  Lambdas on push to `main`. The two escalation Lambdas are still built and
  uploaded by hand.
- **Alarms exist and publish to an SNS topic nothing is subscribed to**, so the
  dashboard's Health page is currently the only place a firing alarm is visible.

## Status caveats — built, not proven

This is the honest section, and the one that changes fastest.

| Area | State |
| --- | --- |
| **Device verification** | The alarm engine — sounds, bursts, the time-sensitive interruption level, exact alarms, the seven-day horizon, silent push, real push tokens — is **built and unverified on a physical phone**. It needs a native rebuild, and the last TestFlight attempt failed on a provisioning profile predating the Time Sensitive Notifications capability |
| **SMS** | Both SMS features — verification codes at sign-up and the SMS escalation rung — are blocked on the account's SNS sandbox. The app flag is off and the pool emails codes instead |
| **E2E in CI** | Two iOS Maestro flows exist and were green on GitHub's macOS runners. They **cannot currently run**: the repository went private, macOS minutes bill at 10× wall-clock, and the choice between paying for minutes, paying for EAS, or making the repository public again is open |
| **Web menus** | The gender and condition pickers are unusable on web — a `react-native-paper` `Menu` never animates in on this web stack. Parked deliberately; probably web-only, unconfirmed on device |
| **Security** | The unauthenticated debug and reset routes, plaintext database credentials in Lambda environment variables, and the master-user database connection are all **known and deliberately deferred** to a separate security effort that is referenced throughout the repository but has no plan file in it |
| **Test coverage** | Dependency-free modules and all three Lambdas are well covered by `node --test`. Components and hooks are not covered at all; that needs jest-expo, which has not been taken on |

## Where this is in its life

Internal testing. The only accounts on the deployed stack belong to the owner
and a small number of beta testers who have agreed to be experimented on, which
is why application data is treated as disposable and the database is rebuilt
rather than reconciled when it drifts. **Both that posture and the deferral of
the security work are time-limited by their own terms** — they are revisited
before any real patient exists.
