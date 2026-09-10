-- Test names become localised, the same way genders, conditions and the
-- medication library did in migration 014.
--
-- **`test_config` was the vocabulary 014 missed.** The argument there was that
-- a name living in a lookup row goes through neither the locale files nor the
-- per-locale columns, so a profile in 中文 still read "Male". A lab result is
-- the same shape of string and worse placed: `display_name` is what the results
-- dashboard prints under every chart, on every mini card and against every
-- reading in a report, and it was English for every reader — while still being
-- the seeded placeholders ("Starlight Level", "Reflex Factor") nobody has
-- replaced, because until now there was no screen that could.
--
-- **Why `display_name_en` rather than keeping `display_name` and adding
-- `display_name_zh_hant`.** 010's and 014's argument, applied a third time:
-- English-as-the-bare-column is a convention nothing enforces and every reader
-- has to know. Naming the language makes the pair symmetric, and a query that
-- forgot to localise fails to compile instead of quietly serving English to
-- everyone. The rename is safe for installed builds because `/test-config`
-- still returns a flat `display_name` — resolved for the reader, the way
-- `/genders` has returned a flat `name` since 014.
--
-- **`units` is deliberately not localised.** "mmol/L" and "mmHg" are SI symbols
-- rather than words; translating a column no reader would want translated is
-- work with no reader, the same call 014 made for `conditions.description`.
--
-- **No Chinese is backfilled here, and that is migration 015's decision rather
-- than an omission.** These names are clinical, so the wording belongs to
-- whoever owns the content. A NULL falls back to English on the device and
-- shows as "not translated" in the Envars editor, which is exactly the prompt
-- staff need; a plausible-looking wrong translation is invisible.
--
-- Guarded on the column actually being there, so a replay against an
-- already-migrated database is a no-op rather than an error.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'test_config' AND column_name = 'display_name') THEN
        ALTER TABLE test_config RENAME COLUMN display_name TO display_name_en;
    END IF;
END $$;

ALTER TABLE test_config ADD COLUMN IF NOT EXISTS display_name_zh_hant TEXT;
