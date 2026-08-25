# Product definition

Two descriptions of the same product, written to be revised rather than
rewritten.

| File | What it is |
| --- | --- |
| [`current-state.md`](current-state.md) | **v1 — as built.** What exists and runs, as of the date at the top of the file |
| [`target-state.md`](target-state.md) | **v2 — every plan implemented.** The same product with every plan written down in this repository carried out |

Neither is a roadmap and neither carries dates. `PLAN.md` §0.2 is the ledger for
what is done; these files say what the *product* is, which is a different
question and goes stale far more slowly.

## The invariant that makes revision cheap

**The two files are written section-for-section, in the same order, with the
same headings.** That is not tidiness — it is the whole mechanism. A revision is
a diff, not a re-read:

- If a capability moves from v2 to v1, it moves **between the same two sections**
  in both files.
- v2 states only what *changes*, and says "unchanged" where nothing does. It
  never restates v1, so v1 can be edited without touching v2.
- v2 ends with a delta table naming the source of every line. When an item lands,
  find it there, move it, and delete its row.

**When everything is done, `current-state.md` should read as `target-state.md`
does, minus the change-tracking sections, and `target-state.md` should be
empty of deltas.** That is the finish condition. At that point either delete v2
or reseed it from whatever the next plan is.

## Where each section comes from

Revising a section means re-reading its sources, not the repository. This table
is the reason this folder can be maintained without a fresh survey each time.

| Section | Sources |
| --- | --- |
| Identity, caregiver links, revocation | `PLAN.md` §0.2 rows 3.1–3.6, §2 D-7; `tish-app/backend/index.mjs` (`user_relationships`, `/relationships/*`) |
| Reminders, alarms, snooze, horizon | `PLAN.md` §0.2 rows 4.x and 5.6, §2 D-1/D-2/D-6/D-9/D-10; `tish-app/utils/{alarm-schedule,notification-budget,notification-identifiers,alarm-settings}.ts` |
| Escalation | `PLAN.md` §0.2 rows 5.4/5.5/5.8/5.9, §2 D-3/D-5/D-8/D-12; `tish-app/backend/escalate.mjs`, `escalation-policy.mjs` |
| Appointments, results, announcements | `SCHEMA_SQL` in `tish-app/backend/index.mjs`; `tish-app/app/(tabs)/`, `app/news.tsx` |
| Language, accessibility, error contract | `PLAN.md` §0.2 rows 6.1/6.2; `tish-app/locales/`, `utils/api-errors.ts`, `hooks/use-text-to-speech.ts`, `hooks/use-voice-dictation.ts` |
| Staff dashboard | `dashboard/README.md`, `dashboard/AWS-SETUP.md`, `dashboard/src/features/*` |
| Measurement, BI | `TELEMETRY.md` (§1 is the routing rule and the actual design), `telemetry/README.md`, `telemetry/metabase/README.md` |
| Operating context, regions, VPC | `MIGRATION.md` Progress + "Why this shape"; `docs/architecture/README.md`; `tish-app/backend/DEPLOY.md` |
| Non-goals | `PLAN.md` §2 (D-2, D-5, D-10), §0.8; `TELEMETRY.md` §3, §4 |
| Status caveats | `PLAN.md` §0.3, §0.4, §0.7; `HANDOFF.md`; `REBUILD.md` |
| Target-state deltas | The delta table at the foot of `target-state.md` names one source per row |

`docs/architecture/tish-aws-future.svg` is the shortest way to see the target
infrastructure: anything drawn in a **dashed red box** does not exist yet.

## How to revise

1. **Check whether it is even stale.** `git log --oneline --since=<date at the
   top of current-state.md>` against the repository root. If nothing landed,
   nothing here needs touching.
2. **Read `PLAN.md` §0.2 and §0.3 first.** The ledger is the only part of that
   document that tracks reality; §3–§9 describe the *original* defects and are
   deliberately never updated.
3. For each landed item, find its row in the v2 delta table, **move the
   capability into the matching v1 section**, and delete the row.
4. **Only then** look for new capabilities that no plan predicted. Those are the
   ones a diff cannot find, and the cheapest place to catch them is the commit
   subjects since the last revision.
5. Re-date the header of `current-state.md`.
6. If a plan was abandoned rather than completed, move it to that document's
   non-goals section with the reason. **Do not delete it silently** — a
   disappeared plan reads as an oversight and gets re-proposed.

Two numbers worth re-checking rather than trusting, because they are quoted in
v1 and both drift:

```bash
node -e "const f=require('./tish-app/locales/en.json');let n=0;(function w(o){for(const k in o){if(o[k]&&typeof o[k]==='object')w(o[k]);else n++}})(f);console.log(n)"
```

```bash
ls tish-app/backend/migrations/*.sql | wc -l
```

## Things that will bite

- **`PLAN.md` is behind the repository, and knows it.** Its ledger stops at
  session 9 (2026-08-01) and `HANDOFF.md` at session 11, but the git history
  carries a further fortnight of work — the admin dashboard subtree import,
  localised news publishing, the whole telemetry pipeline, Metabase, alarms and
  log retention. **Read the git log before believing any "what is left" claim in
  a plan file.**
- **The architecture diagram and `TELEMETRY.md` disagree about Metabase.**
  `docs/architecture/src/build.mjs` marks the BI server and its disk as
  not-yet-built, while `TELEMETRY.md` and `telemetry/metabase/README.md` record
  it running at `bi.ti-smarthealth.com` since 2026-08-15, and the dashboard can
  start and stop it. These documents treat it as **built**. Worth resolving in
  the diagram rather than carrying the contradiction forward.
- **The security plan is referenced everywhere and exists nowhere.** Four
  documents defer findings to it. Until it is written, `target-state.md`'s
  security section is an assembled union of those findings, not a summary of a
  plan.
- **"Done" in a plan file rarely means "verified on a device."** The distinction
  between built, deployed, probed against live, and confirmed on physical
  hardware is the single most important thing `current-state.md` tracks, and
  collapsing it is how this product would come to be described as finished when
  its central feature has never rung a phone.
- **Two untracked scratch files at the repository root** (`opus 5 vs 4.8.txt`
  and `Create a plan to develop a Europa U.txt`) belong to unrelated projects.
  They are not part of this product and are deliberately excluded from every
  commit.
