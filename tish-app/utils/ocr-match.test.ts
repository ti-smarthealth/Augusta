import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTestDate, firstNumber, matchRows, normalise } from './ocr-match.ts';

const fields = [
  { field_number: 1, display_name_en: 'Fasting glucose', display_name_zh_hant: '空腹血糖' },
  { field_number: 2, display_name_en: 'HbA1c', display_name_zh_hant: '糖化血色素' },
  { field_number: 3, display_name_en: 'Total cholesterol', display_name_zh_hant: '總膽固醇' },
  { field_number: 4, display_name_en: 'HDL cholesterol', display_name_zh_hant: null },
  { field_number: 5, display_name_en: 'Creatinine', display_name_zh_hant: '肌酸酐' },
];

const rows = (...texts: string[]) => texts.map((text) => ({ text }));

test('normalise folds width, case and spacing', () => {
  assert.equal(normalise('糖化 血色素 ：６.５'), '糖化血色素:6.5');
  assert.equal(normalise('HbA1c (NGSP)'), 'hba1c(ngsp)');
});

test('firstNumber takes the value and skips a reference range after it', () => {
  assert.equal(firstNumber(' 6.5 % 4.0-6.0'), '6.5');
  assert.equal(firstNumber(': 98 mg/dL (70 ~ 100)'), '98');
});

test('firstNumber skips a reference range printed before the value', () => {
  assert.equal(firstNumber(' 4.0-6.0 6.5'), '6.5');
  assert.equal(firstNumber(' 70–100 98'), '98');
});

test('firstNumber skips a date and a letter-glued token', () => {
  assert.equal(firstNumber(' 2024/05/06 6.5'), '6.5');
  assert.equal(firstNumber('(NGSP) A1c 6.5'), '6.5');
  assert.equal(firstNumber(' 113.05.06 98'), '98');
});

test('firstNumber strips a < or > qualifier and returns null when there is nothing', () => {
  assert.equal(firstNumber(' <0.5 mg/L'), '0.5');
  assert.equal(firstNumber(' mmol/L 4.0-6.0'), null);
  assert.equal(firstNumber(''), null);
});

test('matches by the English name, the Chinese name or both on one row', () => {
  const fill = matchRows(rows(
    '空腹血糖 Glucose AC 98 mg/dL 70-100',
    '糖化血色素 HbA1c 6.5 % 4.0-6.0',
    'Creatinine 1.1 mg/dL',
  ), fields);
  assert.equal(fill.values.field_1?.value, '98');
  assert.equal(fill.values.field_2?.value, '6.5');
  assert.equal(fill.values.field_5?.value, '1.1');
  assert.equal(fill.values.field_5?.name, 'Creatinine');
  assert.deepEqual(fill.unmatched, []);
});

test('the longer name wins a row it shares with a shorter one', () => {
  const fill = matchRows(rows(
    'HDL Cholesterol 1.2 mmol/L',
    'Total Cholesterol 5.1 mmol/L',
  ), fields);
  assert.equal(fill.values.field_4?.value, '1.2');
  assert.equal(fill.values.field_3?.value, '5.1');
});

test('a name with no number after it on the row fills nothing', () => {
  const fill = matchRows(rows('HbA1c', '6.5 %'), fields);
  assert.equal(fill.values.field_2, undefined);
  assert.deepEqual(fill.unmatched, ['HbA1c', '6.5 %']);
});

test('each field takes its top-most row and each row serves one field', () => {
  const fill = matchRows(rows(
    'HbA1c 6.5 %',
    'HbA1c 6.9 % (previous)',
  ), fields);
  assert.equal(fill.values.field_2?.value, '6.5');
  assert.deepEqual(fill.unmatched, ['HbA1c 6.9 % (previous)']);
});

test('unmatched rows come back in page order and blank rows are dropped', () => {
  const fill = matchRows(rows('臺大醫院 檢驗報告', '  ', '姓名 王小明', 'HbA1c 6.5'), fields);
  assert.deepEqual(fill.unmatched, ['臺大醫院 檢驗報告', '姓名 王小明']);
});

test('a one-character name never matches', () => {
  const fill = matchRows(rows('Vitamin K 12'), [{ field_number: 9, display_name_en: 'K' }]);
  assert.equal(fill.values.field_9, undefined);
});

test('an empty config or an empty scan is harmless', () => {
  assert.deepEqual(matchRows([], fields).values, {});
  assert.deepEqual(matchRows(rows('HbA1c 6.5'), []).values, {});
});

test('detectTestDate reads Gregorian and ROC dates, first in reading order', () => {
  const now = new Date(2026, 8, 22);
  const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
  assert.equal(detectTestDate(rows('採檢日期 2026/05/06 08:12'), now)?.getTime(), local(2026, 5, 6));
  assert.equal(detectTestDate(rows('報告日期：115年5月6日'), now)?.getTime(), local(2026, 5, 6));
  assert.equal(detectTestDate(rows('115.05.06', '2026-09-01'), now)?.getTime(), local(2026, 5, 6));
});

test('detectTestDate ignores a birth date, an impossible date and a future year', () => {
  const now = new Date(2026, 8, 22);
  assert.equal(detectTestDate(rows('出生 1958/03/12'), now), null);
  assert.equal(detectTestDate(rows('2026/13/40'), now), null);
  assert.equal(detectTestDate(rows('2026/02/30'), now), null);
  assert.equal(detectTestDate(rows('2028/01/01'), now), null);
  assert.equal(detectTestDate(rows('HbA1c 6.5'), now), null);
});

// The live test_config names are the long form with abbreviations in
// brackets; a report prints one of the parts. These pin the alias derivation
// and the word-boundary rule that keeps a short alias from matching inside
// another word.
import { aliasesOf } from './ocr-match.ts';

test('aliasesOf splits the long form into printable parts', () => {
  assert.deepEqual(aliasesOf('Hemoglobin (HGB / Hb)'), ['Hemoglobin', 'HGB', 'Hb']);
  assert.deepEqual(aliasesOf('Aspartate Aminotransferase (AST / GOT)'), ['Aspartate Aminotransferase', 'AST', 'GOT']);
  assert.deepEqual(aliasesOf('Neutrophils'), ['Neutrophils', 'Neutrophil']);
  assert.deepEqual(aliasesOf('血比容／紅血球容積比'), ['血比容', '紅血球容積比']);
  assert.deepEqual(aliasesOf('Creatinine'), ['Creatinine']);
});

const liveFields = [
  { field_number: 1, display_name_en: 'White Blood Cell Count (WBC)', display_name_zh_hant: '白血球計數' },
  { field_number: 3, display_name_en: 'Hemoglobin (HGB / Hb)', display_name_zh_hant: '血紅素' },
  { field_number: 10, display_name_en: 'Neutrophils', display_name_zh_hant: '嗜中性白血球' },
  { field_number: 27, display_name_en: 'Alanine Aminotransferase (ALT / GPT)', display_name_zh_hant: '丙胺酸轉胺酶' },
];

test('a report line matches by abbreviation, by singular, and by the Chinese head', () => {
  const fill = matchRows(rows(
    'WBC 白血球 7.2 10^3/uL 4.0-10.0',
    'Hb 血紅素 13.5 g/dL',
    'Neutrophil 62.1 %',
    'GPT 28 U/L',
  ), liveFields);
  assert.equal(fill.values.field_1?.value, '7.2');
  assert.equal(fill.values.field_3?.value, '13.5');
  assert.equal(fill.values.field_10?.value, '62.1');
  assert.equal(fill.values.field_27?.value, '28');
});

test('a short Latin alias does not match inside another word', () => {
  const fill = matchRows(rows('HbA1c 6.5 %', 'ALTERNATE 12'), liveFields);
  assert.equal(fill.values.field_3, undefined, 'Hb must not match HbA1c');
  assert.equal(fill.values.field_27, undefined, 'ALT must not match ALTERNATE');
});

// Three patterns from the first batch of real reports (2026-09-22).
import { valueBeforeName } from './ocr-match.ts';

test('a unit scale such as 10^3/uL or x10~6 is never taken as the value', () => {
  assert.equal(firstNumber(' 3.91-9.05 10^3/ul 6.03 6.47'), '6.03');
  assert.equal(firstNumber(': 10.2 x10~3/ul (3.6-11.2)'), '10.2');
  assert.equal(firstNumber(' x100 3.92~9.24x1000/uL 6.09'), '6.09');
});

test('a value printed before the Chinese name, with its unit between, is preferred', () => {
  const fields = [
    { field_number: 24, display_name_en: 'Creatinine', display_name_zh_hant: '肌酸酐' },
    { field_number: 30, display_name_en: 'Albumin', display_name_zh_hant: '白蛋白' },
  ];
  const fill = matchRows(rows(
    'CRE 1.21 mg/dL 肌酸酐 0.70 1.30',
    'ALB-BCG 4.7 g/dL 白蛋白 3.5 5.7',
  ), fields);
  assert.equal(fill.values.field_24?.value, '1.21');
  assert.equal(fill.values.field_30?.value, '4.7');
  assert.equal(valueBeforeName('wbc 10.76 h 10^3/ul '), '10.76');
  assert.equal(valueBeforeName('cbc routine '), null);
});

test('a Simplified reading of a Traditional name still matches', () => {
  const fields = [
    { field_number: 2, display_name_en: 'Red Blood Cell Count (RBC)', display_name_zh_hant: '紅血球計數' },
    { field_number: 9, display_name_en: 'Red Cell Distribution Width (RDW)', display_name_zh_hant: '紅血球分布寬度' },
  ];
  const fill = matchRows(rows('红血球计数 4.43 million/uL', '红血球分布變數 RDW 15.6 %'), fields);
  assert.equal(fill.values.field_2?.value, '4.43');
  assert.equal(fill.values.field_9?.value, '15.6');
});

test('the absolute count is not read as the percentage it is named after', () => {
  const fields = [
    { field_number: 10, display_name_en: 'Neutrophils', display_name_zh_hant: '嗜中性白血球' },
    { field_number: 11, display_name_en: 'Absolute Neutrophil Count (ANC)', display_name_zh_hant: '絕對嗜中性白血球計數' },
  ];
  // The model dropped 計, so the ANC name does not match either; the row must
  // then fill nothing rather than put 4224 in the percentage field.
  const fill = matchRows(rows('绝對嗜中性白血球数 4224 uL 1570-5950', '嗜中性白血球 62.1 %'), fields);
  assert.equal(fill.values.field_10?.value, '62.1');
  assert.equal(fill.values.field_11, undefined);
  const exact = matchRows(rows('絕對嗜中性白血球計數 4224 /uL'), fields);
  assert.equal(exact.values.field_11?.value, '4224');
  assert.equal(exact.values.field_10, undefined);
});

// Migration 019: staff-curated aliases ride in as comma-separated text and
// match exactly as the two names do.
import { splitAliases } from './ocr-match.ts';

test('splitAliases takes either comma, semicolons or newlines and drops blanks', () => {
  assert.deepEqual(splitAliases('Segment, Neut，嗜中性球;  ,\nSeg.'), ['Segment', 'Neut', '嗜中性球', 'Seg.']);
  assert.deepEqual(splitAliases(null), []);
  assert.deepEqual(splitAliases('   '), []);
});

test('a configured alias matches a printed name the long form does not contain', () => {
  const fields = [
    { field_number: 10, display_name_en: 'Neutrophils', display_name_zh_hant: '嗜中性白血球', aliases: 'Segment, Neut' },
    { field_number: 5, display_name_en: 'Platelet Count (PLT)', display_name_zh_hant: '血小板計數', aliases: null },
  ];
  const fill = matchRows(rows('Segment 80.0 % 42-74', 'Platelets 376 1000/uL'), fields);
  assert.equal(fill.values.field_10?.value, '80.0');
  assert.equal(fill.values.field_10?.name, 'Segment');
  assert.equal(fill.values.field_5, undefined, 'no alias yet, so "Platelets" still does not match');
});
