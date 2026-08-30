-- Clear the Chinese on conditions and the medication library, keeping genders.
--
-- **These were placeholders and should not have shipped as if they were
-- approved.** Migration 014 backfilled a translation for every seeded row so
-- the feature could be seen working end to end. That was right for genders —
-- 男性 / 女性 / 非二元性別 / 不願透露 is a closed, ordinary vocabulary — and
-- wrong for the other two, where the names are clinical and the wording is a
-- decision for whoever owns the content, not for whoever wrote the migration.
--
-- A wrong translation is worse than an absent one here: absent falls back to
-- English and is visibly missing in the editor, which is exactly the prompt
-- staff need. A plausible-looking wrong one is invisible.
--
-- Not a revert of 014: that migration is applied and stays applied. This is the
-- content decision expressed as data, and `SEED_SQL` is changed to match so a
-- `/reset-db` + `/seed-data` does not reintroduce what this removes.
--
-- Genders are deliberately untouched.

UPDATE conditions SET name_zh_hant = NULL;
UPDATE medication_library SET name_zh_hant = NULL;
