-- Ninety-nine result slots instead of thirty.
--
-- `test_results` stores one reading per fixed column, `field_N`, and a
-- `test_config` row labels one of them; the number of columns is therefore
-- the number of tests the app can track at all, and thirty was reached as
-- soon as a full blood count and a liver panel were configured together.
--
-- **This raises the cap; it does not remove it.** One row per reading (a
-- `test_result_values` table) would, and is the better long-term shape —
-- it would also dissolve the slot rules the admin API has to enforce. It is
-- a day's refactor across every consumer, so for now the cap moves to 99,
-- which is the largest number the two-digit slot display in the Envars tab
-- shows comfortably and more than any panel this app is likely to hold.
--
-- One statement per column, all IF NOT EXISTS, so a replay is a no-op.

ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_31 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_32 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_33 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_34 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_35 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_36 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_37 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_38 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_39 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_40 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_41 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_42 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_43 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_44 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_45 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_46 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_47 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_48 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_49 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_50 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_51 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_52 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_53 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_54 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_55 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_56 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_57 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_58 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_59 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_60 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_61 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_62 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_63 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_64 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_65 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_66 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_67 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_68 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_69 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_70 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_71 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_72 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_73 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_74 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_75 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_76 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_77 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_78 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_79 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_80 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_81 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_82 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_83 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_84 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_85 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_86 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_87 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_88 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_89 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_90 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_91 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_92 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_93 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_94 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_95 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_96 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_97 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_98 NUMERIC;
ALTER TABLE test_results ADD COLUMN IF NOT EXISTS field_99 NUMERIC;
