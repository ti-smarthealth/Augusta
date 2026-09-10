# Deploy setup (one-time)

**Done — the OIDC provider, the role and the repo variables all exist.** Kept as
the record of how it is wired and what to change if a name or region moves.

Pushing to `main` auto-deploys, all from this one repo. **Audited against the
live account and `gh variable list` on 2026-09-10** — every row below was
checked, not remembered:

| Workflow | Triggers on | Target |
| --- | --- | --- |
| `deploy-backend.yml` | `tish-app/backend/**` | Lambdas `operation-strix`, `tish-migrate`, `tish-escalate-dispatch`, `tish-escalate-db` |
| `deploy-admin-api.yml` | `dashboard/server/**` | Lambdas `tish-admin-api` **and `tish-admin-translations`** |
| `deploy-cognito-triggers.yml` | `dashboard/cognito-triggers/**` | Lambda `tish-admin-presignup` |
| `deploy-telemetry.yml` | `telemetry/**` | Lambdas `tish-telemetry-ingest`, `tish-telemetry-rollup`, `tish-telemetry-rollup-db` |
| `deploy-dashboard.yml` | `dashboard/**` (excl. `server/`) | Amplify app `d1x8yq4r6ivp8n` |
| `deploy-patient-web.yml` | `tish-app/**` (excl. `backend/`, `.maestro/`, `.eas/`) | Amplify app `d1d46k6rhmlsza` |
| `translations.yml` | `tish-app/locales/**` | EAS Update, branch `production` — validation is the gate |

The iOS build is the one shipping path not on this list: `submit-ios.yml` runs
on a `v*` tag or by hand, not on a push to `main`.

> **Still hand-deployed: the three `line/` Lambdas** — `tish-line-webhook`,
> `tish-line-send`, `tish-line-db`. No workflow matches `line/**` at all, so a
> change there ships only when somebody builds a zip and calls
> `update-function-code`. The deploy role's allowlist already carries all three
> (added when they were created, see `line/README.md` §3), so adding them is a
> workflow away and needs no IAM change.
>
> `tish-escalate-db` and `tish-escalate-dispatch` **used** to be the entry in
> this slot. They joined `deploy-backend.yml` on 2026-09-09 and are confirmed
> shipping from CI — both were updated by the run for 7a4b443. The two things
> that had kept them off it were the zip omitting `escalate.mjs` *and* the role
> lacking their ARNs; fixing only the first produced a half-applied deploy.

> **Deploying `tish-migrate` does not run a migration.** It has no trigger of
> any kind; CI only puts the files where the runner can see them. Applying is
> `{"command":"status"}` → `{"command":"up","dryRun":true}` → `{"command":"up"}`
> against the function, by hand:
>
> ```bash
> aws lambda invoke --function-name tish-migrate --region ap-east-2 \
>   --cli-binary-format raw-in-base64-out --payload '{"command":"status"}' out.json
> ```
>
> **A migration and the code that reads its column want opposite orders, and
> the way out is not a separate commit.** The runner executes the `migrations/`
> directory *out of the zip CI builds*, so a migration cannot be applied until
> its file has reached the function — while `migrate.test.mjs` fails any commit
> whose migration adds a column `SCHEMA_SQL` does not mirror, and that test
> gates the deploy job. A migration-only commit therefore turns `main` red and
> deploys nothing, which is what happened to a209060 on 2026-09-10.
>
> Two orders work. **Preferred, and what 016 and 017 did** (`line/README.md`
> §1): build a zip of `migrate.mjs migrations package.json node_modules` —
> deliberately *without* `index.mjs` — deploy it to `tish-migrate` alone from
> the working tree, apply, then commit and push handler and migration together.
> `zip` is not installed on this machine; `py/.venv` has a real Python and
> `python -m zipfile -c` writes the forward-slash entries Lambda requires.
>
> Otherwise: push the two together, wait for **Deploy backend Lambda** to go
> green, and apply immediately — accepting a window of a minute or two where
> the deployed handler reads a column that does not exist yet. Know what that
> costs before choosing it. For 018 it was benign: `/test-config` returned null
> names, because the rename only made `localisedField` find nothing. A handler
> that *names* the new column in SQL would 500 for that whole window instead.

> The dashboard used to be a separate repository with its own copy of the first
> two workflow files. It was imported here as a subtree on 2026-08-08 and those
> copies were moved to this repo's `.github/workflows/` — GitHub only reads
> workflows from the repository root, so where they sat before, they no longer
> ran at all.

Auth uses **GitHub OIDC**: the workflow assumes an IAM role with short-lived
credentials — no AWS access keys are ever stored in GitHub. Deploys replace
*code only*; Lambda environment variables (DB credentials etc.) are untouched.

## 1. Create the GitHub OIDC identity provider (once per AWS account)

IAM console → Identity providers → **Add provider**:
- Provider type: **OpenID Connect**
- Provider URL: `https://token.actions.githubusercontent.com`
- Audience: `sts.amazonaws.com`

## 2. Create the deploy role (once — one role covers every target)

IAM console → Roles → **Create role** → Web identity → the provider above,
audience `sts.amazonaws.com`. After creation, replace its **trust policy** with
(substitute your account id, and the repo names if they ever change):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "_comment_": "Both sub patterns are needed. The ti-smarthealth org sends GitHub's ID-suffixed subject format — repo:ti-smarthealth@321049237/Augusta@1179846297:ref:... — so the name-only pattern alone does NOT match; it is kept for the case where the org's claim format is ever switched back. Verified from CloudTrail, 2026-08-25, after the repo moved from the personal account (whose claims were name-only). Remove this key before pasting into IAM.",
        "StringLike": {
          "token.actions.githubusercontent.com:sub": [
            "repo:ti-smarthealth/*",
            "repo:ti-smarthealth@321049237/*"
          ]
        }
      }
    }
  ]
}
```

Attach an inline **permissions policy** naming exactly the functions it may
update — the sketch below is the minimum, not what is live (substitute
region/account/function names):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:UpdateFunctionCode",
      "Resource": [
        "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:<BACKEND_FUNCTION_NAME>",
        "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:<ADMIN_FUNCTION_NAME>"
      ]
    }
  ]
}
```

Name it e.g. `github-lambda-deploy` and note the **role ARN**.

The shape above is the minimum; **the live policy is an explicit list of
fourteen function ARNs plus two Amplify statements** — one per app, because
`deploy-patient-web.yml` targets `d1d46k6rhmlsza` and the dashboard's grant does
not cover it. Read it rather than assuming:

```bash
aws iam get-role-policy --role-name github-lambda-deploy --policy-name github-lambda-deployPolicy
```

> **A per-function allowlist and a deploy loop fail badly together.** A name in
> a loop that is missing from the policy errors *after* the earlier functions
> have already shipped: the run goes red with half the deploy applied. So a
> function added to a loop needs its ARN added here in the same change — this
> is what kept the escalation pair on hand-deploys through two attempts.
>
> The list also still carries `project-apple`, which no longer exists in
> ap-east-2. Harmless — a grant on a missing function grants nothing — but it is
> dead weight, and a reader counting names against reality will trip on it.

## 3. GitHub repository variables

(Repo → Settings → Secrets and variables → Actions → **Variables** tab.) All set;
current values:

| Variable | Value |
|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::180891490019:role/github-lambda-deploy` |
| `AWS_REGION` | `ap-east-2` |
| `BACKEND_FUNCTION_NAME` | `operation-strix` |
| `ADMIN_FUNCTION_NAME` | `tish-admin-api` |
| `TRANSLATIONS_FUNCTION_NAME` | `tish-admin-translations` |
| `PRESIGNUP_FUNCTION_NAME` | `tish-admin-presignup` |
| `AMPLIFY_APP_ID` | `d1x8yq4r6ivp8n` |
| `PATIENT_WEB_AMPLIFY_APP_ID` | `d1d46k6rhmlsza` |
| `AMPLIFY_REGION` | `ap-northeast-2` |
| `VITE_COGNITO_AUTHORITY` | `https://cognito-idp.ap-east-2.amazonaws.com/ap-east-2_RkCillRxC` |
| `VITE_COGNITO_CLIENT_ID` | `3ke31mij0lu8u4mulvkt388npk` |
| `VITE_COGNITO_DOMAIN` | `https://tish-admin.auth.ap-east-2.amazoncognito.com` |
| `VITE_API_URL` | `https://0u10zqz4r0.execute-api.ap-east-2.amazonaws.com/prod` |
| `VITE_METABASE_URL` | `https://bi.ti-smarthealth.com` |

Two separate regions on purpose: `AWS_REGION` is Taipei, where every Lambda and
the databases live; `AMPLIFY_REGION` is Seoul, because Amplify Hosting has no
ap-east-2 endpoint. See `dashboard/AWS-SETUP.md`.

The `VITE_*` four are compiled into the dashboard bundle at build time and are
public values — variables, not secrets, deliberately. Changing one requires a
re-deploy of the dashboard to take effect.

## Tests

The functional tests (`index.test.mjs`) run automatically in three places:

- **Locally on every commit** — via the committed pre-commit hook, which checks
  each Lambda independently and only runs the suite whose files are staged.
  Enable once per clone:
  ```
  git config core.hooksPath .githooks
  ```
- **On every push/PR** — `.github/workflows/test.yml` for the app backend,
  `dashboard-tests.yml` for the admin Lambda and the SPA. Both are path-filtered
  so a change to one never pays for the other's runners.
- **Before every deploy** — each Lambda deploy workflow refuses to ship a
  failing handler. The two Amplify workflows have no test suite to run; their
  equivalent gate is a typecheck and a build, which is why a type error stops a
  dashboard deploy but a broken interaction does not.

Run manually with `npm test` in the relevant folder.

## Notes

- The workflows **update** existing functions; they don't create them. All ten
  CI-deployed Lambdas and both Amplify apps already exist — see
  `dashboard/AWS-SETUP.md` for the admin side's identifiers, `line/README.md`
  for the three that are not in CI, and `MIGRATION.md` for the region inventory.
- If a repo is renamed on GitHub, update the `repo:...` entries in the trust
  policy — the old name stops matching immediately. (The live trust policy is
  currently broader than the one shown above; see the Known gaps section of
  `dashboard/AWS-SETUP.md`.)
- Regions are per-target, not per-repo: `AWS_REGION` covers the Lambdas and
  `AMPLIFY_REGION` the dashboard. IAM roles are global, so one role spans both.
