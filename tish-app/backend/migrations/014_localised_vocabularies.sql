-- Genders, conditions and the medication library become localised, the same way
-- announcement types did in migration 010.
--
-- **These three tables are the last place the app shows a patient English it
-- never translated.** Everything a screen writes itself goes through the locale
-- files; everything staff write goes through per-locale columns (009, 010). But
-- a name that lives in a lookup row went through neither — so a profile in 中文
-- still read "Male" and "General Wellness", and the medication list showed
-- whatever English somebody typed into the library. The strings were always
-- data, so they were never translatable by adding a key.
--
-- **Why `name_en` rather than keeping `name` and adding `name_zh_hant`.** 010's
-- argument, applied again: English-as-the-bare-column is a convention nothing
-- enforces and every reader has to know. Naming the language makes the pair
-- symmetric, and makes a query that forgot to localise fail to compile instead
-- of silently serving English to everyone. `name_en` stays the natural key for
-- the same reason `label_en` is — a slug would be a second name for the same
-- thing, and a staff rename would leave the two disagreeing.
--
-- `zh_hant` is nullable throughout: a half-translated vocabulary must be
-- visible as such in the editor and fall back to English on the device, which
-- is exactly what a missing row's NULL does. `conditions.description` is left
-- alone deliberately — nothing renders it, and localising a column no screen
-- reads is work with no reader.
--
-- Every step is guarded on the column actually being there, so a replay against
-- an already-migrated database is a no-op rather than an error.

-- --- genders ---------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'genders' AND column_name = 'name') THEN
        ALTER TABLE genders RENAME COLUMN name TO name_en;
    END IF;
END $$;

ALTER TABLE genders ADD COLUMN IF NOT EXISTS name_zh_hant TEXT;

-- The vocabulary is fixed and short, so it is translated here rather than left
-- for staff: these four are not editorial choices the way a condition name is.
UPDATE genders SET name_zh_hant = v.zh
  FROM (VALUES
    ('Male', '男性'),
    ('Female', '女性'),
    ('Non-binary', '非二元性別'),
    ('Prefer not to say', '不願透露')
  ) AS v(en, zh)
 WHERE genders.name_en = v.en AND genders.name_zh_hant IS NULL;

-- --- conditions ------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'conditions' AND column_name = 'name') THEN
        ALTER TABLE conditions RENAME COLUMN name TO name_en;
    END IF;
END $$;

ALTER TABLE conditions ADD COLUMN IF NOT EXISTS name_zh_hant TEXT;

UPDATE conditions SET name_zh_hant = v.zh
  FROM (VALUES
    ('Acute Mission Stress', '急性任務壓力'),
    ('Telepathic Overload', '心靈感應超載'),
    ('Thorn Toxicity', '荊棘毒性'),
    ('General Wellness', '一般健康')
  ) AS v(en, zh)
 WHERE conditions.name_en = v.en AND conditions.name_zh_hant IS NULL;

-- --- medication_library ----------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'medication_library' AND column_name = 'name') THEN
        ALTER TABLE medication_library RENAME COLUMN name TO name_en;
    END IF;
END $$;

ALTER TABLE medication_library ADD COLUMN IF NOT EXISTS name_zh_hant TEXT;

UPDATE medication_library SET name_zh_hant = v.zh
  FROM (VALUES
    ('Anti-Telepathy Serum', '抗心靈感應血清'),
    ('High-Grade Peanut Extract', '高純度花生萃取物'),
    ('Starlight Stamina Mints', '星光耐力薄荷糖')
  ) AS v(en, zh)
 WHERE medication_library.name_en = v.en AND medication_library.name_zh_hant IS NULL;

-- --- keys ------------------------------------------------------------------
--
-- The renames carry the old UNIQUE constraints across with the column, so
-- `genders.name_en` and `conditions.name_en` are still unique — but under names
-- derived from the original column. Re-created on `lower()` here, matching 010:
-- "Male" and "male" are the same entry to everyone except a plain UNIQUE, and
-- the seeds below depend on the case-insensitive form for their ON CONFLICT.
ALTER TABLE genders DROP CONSTRAINT IF EXISTS genders_name_key;
DROP INDEX IF EXISTS genders_name_en_key;
CREATE UNIQUE INDEX IF NOT EXISTS genders_name_en_key ON genders (lower(name_en));

ALTER TABLE conditions DROP CONSTRAINT IF EXISTS conditions_name_key;
DROP INDEX IF EXISTS conditions_name_en_key;
CREATE UNIQUE INDEX IF NOT EXISTS conditions_name_en_key ON conditions (lower(name_en));

-- `medication_library` never had a unique name and does not get one: two
-- products can legitimately share a display name at different dosages, and the
-- add-medicine dialog would start failing on a duplicate it has always allowed.
