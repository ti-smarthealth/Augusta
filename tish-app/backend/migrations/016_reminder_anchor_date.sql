-- The anchor date §0.6 has been asking for since session 3, and the reason the
-- missed-dose list has only ever been trustworthy for daily reminders.
--
-- **The defect.** `materialiseDoses` walks its series from `today`:
--
--     generate_series(0, horizon, frequency_days)  -- offset from today
--
-- The device does not. It anchors its chain on when the reminder was created or
-- last edited and walks forward from there. For `frequency_days = 1` the two
-- agree exactly, which is why this has never shown up — daily is the form
-- default and almost every real row. For a 3-day interval they fall out of
-- phase, so the server materialises a dose on a day the device never alarms,
-- nobody confirms it, and 5.7 reports it as missed. The patient is told they
-- missed a dose that was never due. D-4 asks for a record, not a reprimand, and
-- an invented miss is worse than either.
--
-- **Why the column is nullable, and stays nullable.** `medication_reminders`
-- has no `created_at`, so there is nothing to backfill a true anchor from — the
-- date the device is actually using is not recorded anywhere on the server. A
-- backfill would therefore be a guess wearing the costume of a fact.
--
-- Instead: NULL means "no anchor known", and the materialisation `COALESCE`s it
-- to today, which is exactly the behaviour that exists now. So this migration
-- changes nothing on its own and cannot regress a live row. Rows acquire a real
-- anchor as they are written, and a `frequency_days = 1` row never needs one.
-- Same defensive shape as `COALESCE(u.timezone, ...)` in the query it sits in.
--
-- **Applying this before the handler is deployed is safe, and the reverse is
-- not.** Additive and unread by the deployed code, so it breaks nothing while
-- the new handler is still on its way. Deploying the handler first would have it
-- select a column that does not exist — the `alarm_labels` failure recorded in
-- §0.6. Apply, then deploy.

ALTER TABLE medication_reminders
    ADD COLUMN IF NOT EXISTS anchor_date DATE;

COMMENT ON COLUMN medication_reminders.anchor_date IS
    'Phase origin for materialising non-daily doses: the local date the reminder was created or last edited, matching what the device walks its chain from. NULL degrades to today, which is the pre-016 behaviour. Irrelevant when frequency_days = 1.';
