/**
 * Turn an OCR engine's flat list of text boxes into reading-order rows.
 *
 * **A port of `ocr/rows.py`, rule for rule.** The cloud function groups its
 * boxes server-side; the on-device engine (ML Kit, `ocr-local.ts`) hands back
 * lines with frames and corner points and nothing else, so the same grouping
 * has to exist here. Keep the two in step: a rule that changes in one and
 * not the other makes the two scan buttons disagree on the same photo, which
 * is the one thing a side-by-side test cannot tolerate.
 *
 * The rules, briefly (the Python file has the full reasoning):
 * - two boxes share a row when their vertical centres are within half a box
 *   height, on a *de-skewed* vertical position;
 * - the skew is the median tilt of the long boxes, ignored beyond ±10°;
 * - rows are ordered top to bottom, boxes within a row left to right, and a
 *   row's text is its boxes joined with single spaces.
 *
 * Pure and dependency-free so `node --test` covers it, like `ocr-match.ts`.
 */

import type { OcrRow } from './ocr-match';

export interface OcrLine {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Tilt of the top edge, radians, positive when the right end is lower. */
  theta: number;
}

export interface Quad { x: number; y: number }

/** A box from four corners (top-left, top-right, bottom-right, bottom-left). */
export function lineFromCorners(corners: readonly Quad[], text: string): OcrLine {
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const [a, b] = corners;
  const theta = b.x !== a.x ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
  return {
    text: text.trim(),
    x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
    theta,
  };
}

/** A box from an axis-aligned frame, when corners are not available. */
export function lineFromFrame(
  frame: { left: number; top: number; width: number; height: number },
  text: string,
): OcrLine {
  return {
    text: text.trim(),
    x0: frame.left, y0: frame.top, x1: frame.left + frame.width, y1: frame.top + frame.height,
    theta: 0,
  };
}

const height = (l: OcrLine) => Math.max(l.y1 - l.y0, 1);
const width = (l: OcrLine) => l.x1 - l.x0;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The page's rotation in radians, from the median tilt of the long boxes. */
export function estimateSkew(lines: OcrLine[]): number {
  const votes = lines.filter((l) => width(l) >= 3 * height(l) && width(l) >= 40).map((l) => l.theta);
  if (votes.length < 3) return 0;
  const skew = median(votes);
  return Math.abs(skew) <= (10 * Math.PI) / 180 ? skew : 0;
}

/** Group boxes into rows by de-skewed vertical position, top to bottom. */
export function groupRows(lines: OcrLine[]): OcrRow[] {
  const kept = lines.filter((l) => l.text !== '');
  const slope = Math.tan(estimateSkew(kept));
  const centreY = (l: OcrLine) => (l.y0 + l.y1) / 2 - slope * ((l.x0 + l.x1) / 2);

  const rows: { y: number; h: number; lines: OcrLine[] }[] = [];
  for (const line of [...kept].sort((a, b) => centreY(a) - centreY(b))) {
    const cy = centreY(line);
    let placed = false;
    for (const row of rows) {
      const tol = Math.max(row.h, height(line)) * 0.5;
      if (Math.abs(cy - row.y) <= tol) {
        const n = row.lines.length;
        row.y = (row.y * n + cy) / (n + 1);
        row.h = (row.h * n + height(line)) / (n + 1);
        row.lines.push(line);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ y: cy, h: height(line), lines: [line] });
  }

  return rows
    .sort((a, b) => a.y - b.y)
    .map((row) => ({ text: [...row.lines].sort((a, b) => a.x0 - b.x0).map((l) => l.text).join(' ') }));
}
