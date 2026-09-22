# Report scanning (`tish-ocr`)

A patient photographs a printed lab report; the app fills in the results form
with the values it can read; the patient checks, corrects and saves — through
the same `/test-results` route, with the same validation, as a manual entry.
**Nothing is written to the database by the scan itself.**

## Why it is shaped this way

**Every hospital prints its own report.** Test names, column order, units and
reference ranges all differ, and a Taiwanese report routinely carries the same
test under a Chinese name and an English abbreviation on one line. There is no
parse of that page that is safe to commit without a person looking at it. So
the pipeline is split at exactly that point:

- the **OCR function** returns what the page *says* — rows of text, top to
  bottom, with coordinates — and knows nothing about tests, fields or users;
- the **device** matches those rows against the very `test_config` names the
  form is already labelled with (`tish-app/utils/ocr-match.ts`, pure and
  unit-tested), fills the inputs, and marks each filled value "read from your
  report — please check" until the user edits it;
- the **user** saves, or doesn't.

**In-account, in-region.** Amazon Textract is not offered in ap-east-2, and a
patient's lab report leaving Taiwan to be read would cut across the residency
stance the rest of the stack was moved here for. The OCR runs on our own
Lambda, on our own bucket, next to the database.

**ONNX, not PaddlePaddle.** The PP-OCR models are the right ones for
Traditional Chinese, but the Paddle framework is over a gigabyte, x86-only in
practice and slow to cold start. `rapidocr_onnxruntime` ships the same models
exported to ONNX: a ~390MB image, a few seconds' cold start, and a phone photo
of an A4 report reads in seconds at 2GB of memory. At that shape a scan costs a
fraction of a cent and an idle month costs nothing; the always-on alternative
starts at $25/month before the first page.

## The pipeline

```
app  ──POST /ocr/scans──────▶  operation-strix   signs two URLs; no S3 call, no DB
app  ──PUT image (15 min)───▶  s3://tish-ocr-scans/uploads/<user>/<job>.jpg
S3   ──ObjectCreated────────▶  tish-ocr          reads it, writes the result, deletes the upload
app  ──GET (polls, 15 min)──▶  s3://tish-ocr-scans/results/<user>/<job>.json
app                            matches rows → fills the form → user reviews → POST /test-results
EventBridge (hourly) ───────▶  tish-ocr {"command":"sweep"}   deletes anything older than an hour
```

| Piece | Where | Notes |
| --- | --- | --- |
| `POST /ocr/scans` | `tish-app/backend/index.mjs` | Presigns PUT `uploads/…` and GET `results/…`, 15-minute TTL. The API Lambda never calls S3 — presigning is arithmetic over its own credentials, which is what keeps this off its VPC and out of its `pg` pool. |
| `tish-ocr` | `ocr/app.py`, `ocr/rows.py` | Python 3.12 container, **x86_64** (onnxruntime aborts in the arm64 sandbox; deploy-ocr.yml has the failure), 3008MB, 90s. EXIF-rotates, downsizes to 2000px, runs RapidOCR, groups boxes into rows. |
| Row grouping | `ocr/rows.py` | Pure geometry; `test_rows.py` is the deploy gate. |
| Matching | `tish-app/utils/ocr-match.ts` | Name found on a row *and* a number after it (or a value-and-unit just before it); longest name wins a shared row; ranges, dates, unit scales (`10^3/uL`) and glued tokens are skipped. Aliases are derived from the configured long form — "Hemoglobin (HGB / Hb)" matches any of its three parts — and Simplified readings of Traditional names are folded. Also reads a printed Gregorian or ROC date. |
| Upload/poll | `tish-app/utils/ocr.ts` | Fixture mode returns a canned Taiwanese report so the review flow runs offline. |
| Screen | `tish-app/app/results-form.tsx` | "Scan a lab report" → camera or library → filled fields carry the row they came from; unmatched lines are listed on request. |

### Retention: one hour, enforced three ways

1. **The upload is deleted by the function** the moment its result is written —
   success or failure. A photo of a report exists in S3 for the seconds it takes
   to read it.
2. **The result is deleted by the hourly sweep.** `RETENTION_SECONDS` (3600)
   on the function; the EventBridge rule `tish-ocr-sweep` invokes it with
   `{"command":"sweep"}` every hour and it deletes every object older than that.
3. **A one-day lifecycle rule on the bucket** is the backstop for a sweep that
   stopped running. **S3 cannot expire by the hour** — `Days` is the unit and 1
   is the floor — which is why the sweep exists at all rather than being a
   lifecycle rule.

The two presigned URLs expire after 15 minutes, so a leaked result URL is
useless well before the sweep would have deleted its target.

## Provisioning (one-time)

`provision.sh` is idempotent and additive; it creates nothing that exists and
adds new inline policies rather than editing `github-lambda-deployPolicy`, so
the audited list in `tish-app/backend/DEPLOY.md` stays as printed.

```bash
./ocr/provision.sh phase1
```

Bucket (private, SSE-S3, CORS for the web build, 1-day lifecycle), ECR repo
`tish-ocr`, execution role `tish-ocr-lambda`, the presign grant on
`operation-strix`'s role, `OCR_BUCKET` merged into `operation-strix`'s
environment, and ECR push + `UpdateFunctionCode` for the deploy role.

Then get an image built: push `ocr/**` to `main`, or run **Deploy OCR Lambda**
from the Actions tab. The workflow's last step fails on the first run because
the function does not exist yet — expected. Then:

```bash
./ocr/provision.sh phase2
```

Creates `tish-ocr` from the `:latest` image, wires the S3 trigger on
`uploads/`, and the hourly sweep rule. From here `deploy-ocr.yml` updates the
function on every push, like every other Lambda in `DEPLOY.md`.

**Until phase1 has run, `POST /ocr/scans` answers 503 `OCR_NOT_CONFIGURED`**
and the app tells the user scanning is unavailable and to type the values in.
The form otherwise works as before.

## What the app build needs

`expo-image-picker` and `expo-image-manipulator` are native modules: **this
ships in a new TestFlight / Play build, not an EAS Update.** `app.json` carries
the picker plugin and the camera and photo-library usage strings (the old
photo-library string said the app did not use the library; it does now).

## Checking it works

- `cd ocr && python -m unittest discover -s . -p 'test_*.py'` — row grouping.
- `cd tish-app && node --test utils/ocr-match.test.ts` — matching and dates.
- `cd tish-app/backend && npm test` — the `/ocr/scans` route.
- `npm run start:mock` in `tish-app`, open New Lab Results, press **Scan a lab
  report**: three fields fill from the fixture, the date becomes 2026-09-15,
  and four unmatched lines are listed.
- Live: `aws logs tail /aws/lambda/tish-ocr --region ap-east-2 --follow`
  while scanning; a line `job <id>: N rows in Nms` per upload, and
  `sweep: deleted N object(s)` once an hour.

## Not done, on purpose

- **No aliases beyond what the configured names contain.** "Segment" for
  neutrophils, "Platelets" for the platelet count, "RDW-CV" where the config
  says RDW: none of these are in the long form, so none match. The right fix
  is a per-test alias list editable in the Envars tab, which is a migration
  plus dashboard work; until then the unmatched list is the fallback.
- **No column model.** A report whose value column is neither directly after
  the name nor value-unit-name (a range printed as two bare numbers, say) can
  still yield the wrong number. The row is shown under the field for exactly
  this reason.
- **No table structure.** PP-Structure would recover columns, but it is heavy
  and the "first number after the name on its row" rule is right for the
  overwhelming majority of printed reports.
- **No on-device OCR.** iOS Vision reads Traditional Chinese well and would
  cost nothing; Android ML Kit is weaker on dense medical text. Worth revisiting
  if the Lambda's per-scan latency ever matters.
