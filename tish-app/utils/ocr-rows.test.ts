// Mirrors ocr/test_rows.py case for case. If a test is added there, add it
// here, and the other way round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateSkew, groupRows, lineFromCorners, lineFromFrame } from './ocr-rows.ts';

const box = (x0: number, y0: number, x1: number, y1: number) =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const tilted = (x0: number, y0: number, w: number, h: number, slope: number) =>
  [{ x: x0, y: y0 }, { x: x0 + w, y: y0 + w * slope }, { x: x0 + w, y: y0 + w * slope + h }, { x: x0, y: y0 + h }];

test('boxes on one printed line join left to right', () => {
  const lines = [
    lineFromCorners(box(300, 100, 340, 120), '6.5'),
    lineFromCorners(box(10, 101, 120, 121), '糖化血色素'),
    lineFromCorners(box(400, 99, 430, 119), '%'),
    lineFromCorners(box(130, 100, 200, 120), 'HbA1c'),
  ];
  assert.deepEqual(groupRows(lines).map((r) => r.text), ['糖化血色素 HbA1c 6.5 %']);
});

test('separate lines become separate rows top to bottom', () => {
  const lines = [
    lineFromCorners(box(10, 200, 100, 220), 'Creatinine'),
    lineFromCorners(box(300, 200, 340, 220), '1.1'),
    lineFromCorners(box(10, 100, 100, 120), 'Glucose'),
    lineFromCorners(box(300, 100, 340, 120), '98'),
  ];
  assert.deepEqual(groupRows(lines).map((r) => r.text), ['Glucose 98', 'Creatinine 1.1']);
});

test('tolerance scales with box height', () => {
  const lines = [
    lineFromCorners(box(10, 100, 200, 140), 'TOTAL CHOLESTEROL'),
    lineFromCorners(box(300, 112, 340, 132), '5.2'),
  ];
  assert.equal(groupRows(lines).length, 1);
});

test('empty text is dropped and no lines give no rows', () => {
  const lines = [lineFromFrame({ left: 10, top: 100, width: 90, height: 20 }, '   '),
                 lineFromFrame({ left: 10, top: 100, width: 90, height: 20 }, 'Sodium')];
  assert.deepEqual(groupRows(lines).map((r) => r.text), ['Sodium']);
  assert.deepEqual(groupRows([]), []);
});

test('a rotated page still pairs each name with its own value', () => {
  const slope = 0.026;
  const names = ['WBC', 'RBC', 'Hb'];
  const values = ['10.76', '6.01', '18.6'];
  const lines = [];
  names.forEach((n, i) => {
    const y = 100 + i * 24;
    lines.push(lineFromCorners(tilted(10, y, 120, 20, slope), n));
    lines.push(lineFromCorners(tilted(900, y + 900 * slope, 90, 20, slope), values[i]));
  });
  for (let i = 0; i < 3; i++) {
    lines.push(lineFromCorners(tilted(200, 100 + i * 24, 600, 20, slope), '平均紅血球血色素濃度 reference'));
  }
  assert.deepEqual(groupRows(lines).map((r) => r.text), [
    'WBC 平均紅血球血色素濃度 reference 10.76',
    'RBC 平均紅血球血色素濃度 reference 6.01',
    'Hb 平均紅血球血色素濃度 reference 18.6',
  ]);
});

test('estimateSkew ignores short boxes and sideways photos', () => {
  const short = Array.from({ length: 5 }, () => lineFromCorners(tilted(0, 0, 30, 20, 0.5), 'x'));
  assert.equal(estimateSkew(short), 0);
  const sideways = Array.from({ length: 4 }, (_, i) => lineFromCorners(tilted(0, i * 30, 300, 20, 1.0), 'long line of text'));
  assert.equal(estimateSkew(sideways), 0);
  const gentle = Array.from({ length: 4 }, (_, i) => lineFromCorners(tilted(0, i * 30, 300, 20, 0.02), 'long line of text'));
  assert.ok(Math.abs(estimateSkew(gentle) - Math.atan(0.02)) < 1e-6);
});
