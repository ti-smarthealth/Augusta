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
