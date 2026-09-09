# Handoff — paste the block below into a new session

Everything below the line is the prompt. `PLAN.md` §0 carries the detail; this
only has to get a cold session to the right starting point without re-deriving
what session 11 already established.

---

Read PLAN.md, starting with §0 (Progress) — it is the ledger and the only part
that tracks what is actually done. Read the guardrails in §1 before deciding
anything is too risky to try.

> **⚠ This file was written at the end of session 11 and is partly stale.**
> Updated 2026-09-08 for the two things that have since changed; everything else
> below is as session 11 left it and has not been re-verified.

**One thing is waiting, and it is a cost decision the owner has to make: a CI
setup that stopped being free when the repository went private.** The TestFlight
and device-verification blockers that used to head this file are both resolved.

## ✅ TestFlight and device verification — both resolved

Build 10's failure (a provisioning profile predating the Time Sensitive
Notifications capability) was fixed on 2026-08-02 and **build 11 shipped**,
carrying every native capability and the alarm-engine JS.

**Testers have since exercised the alarm engine on a physical iOS device
(2026-09-08) and it works as designed:** bundled sounds play rather than the
default chime, a burst arrives as consecutive alerts, alarms break through Focus
modes, a snooze re-fires, responding clears the rest of the burst from the tray,
a real Expo token registered, a server-side escalation push landed, an alarm rang
on a later day with the app backgrounded, and a silent schedule-change push
arrived in the background.

Check `eas build:list` for build state rather than this file — it will go stale
again. `PLAN.md` §0.7 item 2b carries the per-item verification results.

**What is still open on the device side is Android**, and it needs a handset
rather than a build: the alarm-stream notification channel (4.7e) and exact
alarms (5.2) have never run on Android hardware.

Worth knowing why it matters beyond the build: the entitlement is what makes
5.3's `interruptionLevel: 'timeSensitive'` work, which is how a medication alarm
breaks through Focus modes. A build without it degrades silently.

## State in one paragraph

Session 11 built the project's first test layer that runs native code — Maestro
E2E against a real iOS build — and, in the course of getting a test account, found
that **user registration had been broken for everyone** and fixed it. Both E2E
flows are green on iPhone 17 Pro / iOS 26.4. A TestFlight build (number 10) was
submitted at the end of the session.

## Merged

Session 11's nine commits were rebased onto **`main`** (`ec25847..8db80fb`), so
`main` has the registration fix. The `e2e-maestro-ios` branch still exists and
now points at pre-rebase SHAs; it is safe to delete.

`opus 5 vs 4.8.txt` at the repo root is deliberately untracked; it is a scratch
file from an unrelated project.

## ⚠ The repository went private, and that breaks the CI plan

It was public for most of session 11 and is now private. This matters more than
it sounds, because **the choice to run E2E on GitHub Actions was made *because*
the repo was public**: standard runners are free and unmetered for public repos,
which made GitHub's macOS runners a free alternative to EAS's `maestro` job,
which needs a paid plan.

On a private repo that is no longer true. Minutes come out of the plan allowance
and **macOS bills at 10× wall-clock**, so one ~25-minute iOS E2E run consumes
roughly 250 minutes of allowance. A free plan's 2,000 minutes/month is about
eight runs, and session 11 alone used more than that.

Runs after the switch fail in 3–11 seconds with **no failed step**, on ubuntu as
well as macOS — the signature of an exhausted allowance or a spending limit
rather than anything in the code. The last run on real runners was green.

Three ways out; the owner has to pick, and it is a cost decision, not a technical
one:

1. **Make the repo public again** — restores free unmetered runners, changes
   nothing else.
2. **Pay for GitHub Actions minutes**, budgeting for the 10× macOS multiplier.
3. **Pay for EAS and un-park `tish-app/.eas/workflows/e2e-test-ios.yml`** — it is
   written, and its `maestro` job handles simulator provisioning, sharding,
   retries and video capture that the GitHub Actions version spells out by hand.

Until one is chosen, **iOS E2E cannot run in CI**. The flows themselves are
unaffected and `npm run e2e:check` still validates them locally in a second.

## What changed

- **Registration was failing for every user.** `signUp()` omitted `phone_number`
  whenever `SMS_VERIFICATION_ENABLED` was false — which is always — and the pool
  marks that attribute `Required`. Every attempt returned "Attributes did not
  conform to the schema". The omission was deliberate and could never have
  worked: a required attribute cannot be omitted, and `Required` cannot be
  changed after a pool is created.
- **A live Cognito change was made.** `phone_number` was removed from
  `AutoVerifiedAttributes` on `ap-east-2_Z97Td3kcS`, leaving `email` alone there,
  so codes go by email even though a number is now always sent. Cognito forces
  `AttributesRequireVerificationBeforeUpdate` to be a subset, so that dropped to
  `["email"]` too. Applied by round-tripping the live config through
  `update-user-pool`, which resets any parameter it is not given; a before/after
  diff confirmed only those two keys moved. **Re-enabling SMS is now two changes,
  not one:** exit the SNS sandbox *and* restore `phone_number` to
  `AutoVerifiedAttributes`.
- **Profile screen can verify an email address** — needed because
  `AccountRecoverySetting` lists `verified_email` first, so an unverified account
  has no working password reset.
- **Maestro E2E**, iOS-only. See `tish-app/.maestro/README.md`; it is current and
  worth reading before touching a flow.

## State you can rely on

- **Tests: 266 backend, 209 client.** `tsc` clean, eslint 0 errors (36 warnings,
  none new), translations 383 keys across both locales.
- **iOS E2E was green** on `.github/workflows/e2e-ios.yml`, a GitHub `macos-26`
  runner — both flows passing on iPhone 17 Pro / iOS 26.4. It **cannot currently
  run**; see the private-repo section above. `tish-app/.eas/workflows/` holds the
  EAS equivalents, parked.
- **Test account `maestro`** exists in the pool, confirmed, email verified, with a
  matching RDS row (`id: 4`). Its credentials are GitHub repo secrets
  `MAESTRO_USERNAME` / `MAESTRO_PASSWORD`. The flows sign in against the **live**
  backend — `API_BASE_URL` is a hardcoded production URL.
- **TestFlight build 11 shipped 2026-08-02 and the alarm engine is verified on a
  physical iOS device** (2026-09-08). Nothing is owed here; see the section above.

## Tooling on this machine

- **`gh` is installed but not on PATH** in tool shells — use
  `"/c/Program Files/GitHub CLI/gh.exe"`. If `gh auth status` says logged out,
  ask and wait, same as `aws login`.
- **Maestro 2.8.0 is at `C:\maestro`, also not on PATH.** Prefix a shell with
  `$env:PATH = "C:\maestro\bin;$env:PATH"`.
- `npm run e2e:check` syntax-checks every flow in about a second, needs no
  device, and skips cleanly if Maestro is absent. Run it before pushing a flow
  change; a CI round trip is ~25 minutes.

## Diagnose CI from artifacts, not from log text

This is the most transferable thing session 11 learned. Three consecutive E2E
failures were misdiagnosed from log text — two confidently wrong root causes,
~25 minutes of CI each. The first artifact download settled it immediately,
because the UI hierarchy carries element bounds and the screenshots show what was
actually on screen.

```
gh run download <id> --name maestro-debug-output --dir <tmp>
```

Two real failures, both invisible in the logs:

1. **The keyboard covered the submit button** — `login-submit` at y=531..587, the
   keyboard from y=539. Maestro reports `tapOn` as COMPLETED because the element
   is present and on screen, merely occluded, and the tap lands on the keyboard.
2. **iOS's "Save Password?" system dialog** covered the app after a successful
   sign-in, so it hit the second flow of a run but not the first.

Both upstream bugs the flows were originally designed around —
`expo/eas-cli#3153` (`inputText` hanging) and `maestro#3318` (driver dropping
between flows) — **never appeared**. Do not design around them without evidence.
testIDs on plain container `View`s *do* resolve on iOS; an earlier assumption
that they do not was wrong.

## Known broken, deliberately parked

**The gender/condition pickers on signup are unusable on web.** `react-native-paper`'s
`Menu` mounts at `opacity: 0, scale(0)` and never animates in, leaving an
invisible full-screen backdrop, so the next tap dismisses instead of opening it.
Root cause: Paper drives its entire show/hide state machine from animation
completion callbacks, and those never fire on this web stack. **Probably web-only**
— the console reports the native animated module missing, which is not the case on
iOS — but that is unconfirmed, and opening a menu on the TestFlight build would
settle it in seconds. Seven `<Menu>` usages are affected, including
`components/profile-header.tsx`, which every tab screen renders.

A `patch-package` fix was built, verified as infrastructure, and then **reverted at
the owner's request** because it did not fix this bug — it repaired a different,
latent unresolved-promise hang in the same component. Upgrading will not help:
the code is identical in Paper 5.15.3.

## Constraints

- **Do not commit or push unless asked.**
- **Act freely against the live stack.** Only new-user signup is worth protecting
  until the security refactor lands — and note session 11 changed signup, so
  regressions there are the expensive kind.
- **Security belongs to the security plan** — do not raise it, gate on it, or
  unilaterally fix it.
- `aws login` and `gh auth login` both expire — check, then ask and wait.
- Any new user-facing string needs a key in both locale files;
  `npm run validate-translations` enforces parity.
- **Android E2E is parked until after the security refactor** (iOS-first). The
  flows are platform-neutral; restoring it is a workflow trigger and two npm
  scripts, both documented in the parked workflow's header comment.

## Next

**⚠ Apply migration `016` before the next backend deploy.** `index.mjs` in the
working tree selects `anchor_date`, and `deploy-backend.yml` ships the handler on
push to `main` whether or not the migration ran — the `alarm_labels` failure mode
(`PLAN.md` §0.6). 016 is additive and unread by deployed code, so applying it
early is safe; deploying early is not.

Everything through 015 **is** applied — verified against the live runner on
2026-09-08 (`pending: []`). Worth knowing how that was confirmed, because the
obvious check is not sufficient: `tish-migrate status` reports on the migration
files in *its own deployed zip*, so a stale runner cheerfully reports "nothing
pending" about files it has never seen. Check its `LastModified` against
`git log` too.

```
aws lambda invoke --function-name tish-migrate --region ap-east-2 \
  --payload '{"command":"status"}' /dev/stdout
```

Then, in rough order, none of it blocked:

1. **Raise the SNS spend limit** (`MIGRATION.md` B1). `tish-alarms` now reaches
   both a phone (SMS) and an inbox (email), but the account cap is still
   `$1`/month. Every alarm fires `--ok-actions` as well, so an incident is two
   messages — roughly ten incidents before texts stop silently. Email is uncapped
   and covers the record; what the cap costs is the interruption.

**Done on 2026-09-08, live in AWS** — `operation-strix` raised from 128 MB to
256 MB, which `MIGRATION.md` C5 recommended when the region was built and nobody
ever applied; the app's own API had been running at half the memory of the three
functions that joined it later.

**Done on 2026-09-08, uncommitted in the working tree** — `escalate.mjs` and
`escalation-policy.mjs` are now in `deploy-backend.yml` so the escalation pair
deploys with everything else; the missed-dose list has a "Show N more" instead of
silently truncating at twenty; migration `016` adds the reminder anchor date and
`materialiseDoses` walks from it. 309 backend tests and 22 dose tests green, `tsc`
clean, translations parity clean at 440 keys.

The larger target remains an E2E flow that proves **an alarm actually fires** —
the highest-risk silent-failure behaviour in the app, and the original reason
Maestro was chosen over Playwright. Device verification has now shown the alarm
works, but nothing regression-tests it. It is a real design problem, not another
flow file: Maestro cannot move the device clock, so it needs either a reminder
seeded a minute out and a genuine wait, or an `adb`-driven clock change, which is
Android only and therefore parked. Note this is also gated on the CI funding
decision above. Worth its own session.
