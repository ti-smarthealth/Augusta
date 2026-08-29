// Migration 014 — tests for the client-side vocabulary resolver.
//
// The bias is toward the cases that fail *silently*. Every one of these shows a
// patient either the wrong language or a blank where a name should be, with no
// error and no log to say so.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { localisedName } from './vocabulary.ts';

test('prefers the reader’s language', () => {
  const row = { name_en: 'General Wellness', name_zh_hant: '一般健康' };
  assert.equal(localisedName(row, 'name', 'zh-Hant'), '一般健康');
  assert.equal(localisedName(row, 'name', 'en'), 'General Wellness');
});

test('AN UNTRANSLATED ROW FALLS BACK RATHER THAN BLANKING', () => {
  // The nullable column is the whole point: staff can add a medicine now and
  // translate it later, and in between the patient still sees a usable name.
  const row = { name_en: 'Thorn Toxicity', name_zh_hant: null };
  assert.equal(localisedName(row, 'name', 'zh-Hant'), 'Thorn Toxicity');
});

test('an empty string counts as missing, not as a translation', () => {
  // A staff member who clears the field leaves '' behind, not null, and a blank
  // option in a signup dropdown is indistinguishable from a broken screen.
  const row = { name_en: 'Male', name_zh_hant: '   ' };
  assert.equal(localisedName(row, 'name', 'zh-Hant'), 'Male');
});

test('FALLS BACK TO THE FLAT FIELD, WHICH IS WHAT KEEPS OLD BACKENDS WORKING', () => {
  // A build newer than the Lambda sees rows with no pair at all. Without this
  // the medication list would go blank the moment the app updated ahead of the
  // API — the exact skew that ships every time a client update lands first.
  const row = { med_name: 'Aspirin' };
  assert.equal(localisedName(row, 'med_name', 'zh-Hant'), 'Aspirin');
});

test('the pair wins over the flat field when both are present', () => {
  // The flat one is the server's resolution, frozen at fetch time; the pair is
  // what makes a language switch immediate.
  const row = { med_name: 'Aspirin', med_name_en: 'Aspirin', med_name_zh_hant: '阿斯匹靈' };
  assert.equal(localisedName(row, 'med_name', 'zh-Hant'), '阿斯匹靈');
});

test('nothing anywhere is null, so callers can show their own placeholder', () => {
  assert.equal(localisedName({ name_en: null, name_zh_hant: null }, 'name', 'en'), null);
  assert.equal(localisedName(null, 'name', 'en'), null);
  assert.equal(localisedName(undefined, 'name', 'en'), null);
});

test('an unknown locale resolves rather than returning nothing', () => {
  const row = { name_en: 'Male', name_zh_hant: '男性' };
  // @ts-expect-error deliberately outside the union — a stored locale could be
  // anything if the column ever widened ahead of this file.
  assert.equal(localisedName(row, 'name', 'kl'), '男性');
});

test('fields are independent, so one missing translation cannot blank another', () => {
  const row = {
    gender_name_en: 'Female', gender_name_zh_hant: '女性',
    condition_name_en: 'General Wellness', condition_name_zh_hant: null,
  };
  assert.equal(localisedName(row, 'gender_name', 'zh-Hant'), '女性');
  assert.equal(localisedName(row, 'condition_name', 'zh-Hant'), 'General Wellness');
});
