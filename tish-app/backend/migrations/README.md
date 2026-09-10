# Migrations

Numbered, additive `.sql` files applied by `../migrate.mjs`. One file per
change, never edited once it has been applied anywhere.

```bash
cd tish-app/backend
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... node migrate.mjs status
```

```bash
cd tish-app/backend
DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... node migrate.mjs up
```

## Adding one

1. `NNN_short_description.sql`, taking the next free number.
2. Additive only — `ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`. Prefer
   `IF NOT EXISTS` so a re-run is harmless.
3. **Mirror the change into `SCHEMA_SQL` in `../index.mjs`.** That constant is
   the from-scratch definition; if the two drift, a fresh database and a
   migrated one stop agreeing and the difference surfaces much later, in
   production, as a missing column.

## Two things to know about this project specifically

- **Deploys are manual.** Running a migration is a separate act from shipping
  Lambda code — nothing applies these automatically. See `../DEPLOY.md`.
- ~~**The data plane is mid-migration to `ap-east-2`**, so a migration has to be
  applied to both databases.~~ **Not true since 2026-08-03** — Track C's cutover
  finished and Sydney was decommissioned, so `season1` in ap-east-2 is the only
  database there is, reachable only through `tish-migrate` because it is
  private. Kept struck through rather than deleted because the instruction was
  live for six weeks and is worth recognising as retired when it turns up in an
  old note. `schema_migrations` is still per-database, so `status` remains the
  honest answer to "has this been applied here".
- **The migration and its `SCHEMA_SQL` mirror must be in the same commit**, and
  that constrains the order you can deploy in. `../DEPLOY.md` has the two
  sequences that work and the one that leaves `main` red.
