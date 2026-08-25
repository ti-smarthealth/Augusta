-- Where the nightly rollup lands `app.crash` events, so the admin dashboard's
-- Health page can show them without touching Athena on the request path.
--
-- Same contract as telemetry_daily_opens (migration 012): **a cache, not a
-- record.** Every row is derivable from S3 by re-running the rollup, nothing
-- writes here except the rollup job, and losing the table costs one night.
--
-- Rows are grouped, not individual crashes: one row per Taipei day per
-- fingerprint, where the fingerprint hashes (fatal, platform, message) — so a
-- crash that fires a hundred times on launch is one row with crashes = 100,
-- and the Health page reads a short list rather than a log. The raw events,
-- stacks included, stay queryable in Athena for the deep dive.

CREATE TABLE IF NOT EXISTS telemetry_crashes (
    -- Taipei calendar day, resolved in the Athena query that produced it,
    -- exactly as telemetry_daily_opens does and for the same reason.
    day          DATE NOT NULL,
    -- to_hex(md5(fatal:platform:message)), computed in Athena. The grouping
    -- key, stable across days so recurrence is visible.
    fingerprint  TEXT NOT NULL,
    message      TEXT NOT NULL,
    -- 'ios' | 'android' | NULL. Nullable because events recorded before the
    -- client stamped a platform have none, and a rollup that rejected them
    -- would hide exactly the crashes that prompted all of this.
    platform     TEXT,
    fatal        BOOLEAN NOT NULL DEFAULT true,
    crashes      INTEGER NOT NULL,
    -- Distinct cognito_ids, counted in Athena. Not summable across days.
    users        INTEGER NOT NULL,
    -- The newest stack Athena saw for this fingerprint that day. Truncated on
    -- the device; minified in production builds — a hint, not a symbol table.
    sample_stack TEXT,
    -- UTC instant of the newest occurrence that day.
    last_seen_at TIMESTAMPTZ,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- The rollup upserts a trailing window nightly, so a crash buffered on an
    -- offline phone corrects the day it happened, not the day it arrived.
    PRIMARY KEY (day, fingerprint)
);

CREATE INDEX IF NOT EXISTS telemetry_crashes_day_idx
    ON telemetry_crashes (day DESC);
