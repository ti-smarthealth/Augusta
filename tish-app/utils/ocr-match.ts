/**
 * Turns the OCR function's rows of text into values for the results form.
 *
 * **The device does the matching, not the server, and the form does the
 * committing, not the matcher.** Every hospital prints its own report: its own
 * test names, its own column order, its own units. There is no parse that is
 * safe to write straight into `test_results`, so the OCR function (`ocr/`)
 * returns only what the page *says* — rows of text, top to bottom — and this
 * module proposes a value for each field the user is already looking at, from
 * the very same `test_config` names the labels are drawn from. What it
 * proposes lands in the input boxes for the user to check, correct and save,
 * exactly as if they had typed it.
 *
 * Pure and dependency-free, like `vocabulary.ts` and `doses.ts`, because
 * **every rule here fails silently**: a wrong match is a plausible number in
 * the wrong box, which is worse than an empty one. It is also why the
 * matching is deliberately conservative — a field is filled only when one of
 * its names appears in a row *and* a number follows it on that row. Anything
 * this cannot place is handed back as `unmatched` so the screen can show it,
 * and the user can find the value themselves.
 */

export interface OcrRow {
  /** One printed line, its boxes joined left to right with spaces. */
  text: string;
}

/** The subset of a `/test-config` row this needs. */
export interface ScanField {
  field_number: number;
  display_name_en?: string | null;
  display_name_zh_hant?: string | null;
  /** The flat name the server resolved; a third alias when present. */
  display_name?: string | null;
  /**
   * Migration 019: the names hospitals print for this test, comma-separated
   * as staff typed them in the Envars tab ("Segment, Neut, 嗜中性球"). Split
   * here; each piece is matched exactly as the two names are.
   */
  aliases?: string | null;
}

/** The pieces of an `aliases` string: split on commas (either width) or newlines, trimmed, blanks dropped. */
export function splitAliases(aliases: string | null | undefined): string[] {
  if (typeof aliases !== 'string') return [];
  return aliases.split(/[,，;；\n]/).map((s) => s.trim()).filter((s) => s !== '');
}

export interface ScanMatch {
  /** The number as printed, e.g. "6.5" or "98". Always parses with `Number()`. */
  value: string;
  /** The name that matched, as configured — for the "read as …" helper text. */
  name: string;
  /** The row it came from, verbatim, so the user can see the context. */
  row: string;
}

export interface ScanFill {
  /** Keyed `field_<n>`, the same keys the form's state uses. */
  values: Record<string, ScanMatch>;
  /** Rows that matched no field, in page order. */
  unmatched: string[];
  /** A date printed on the report, if one was recognisable. */
  testDate: Date | null;
}

/**
 * Case, width and spacing are OCR noise, not meaning. NFKC folds full-width
 * "６.５" and "：" to "6.5" and ":", and the Chinese names on a report are
 * routinely split into two boxes by the detector, so spaces are dropped
 * entirely for the comparison.
 */
export function normalise(s: string): string {
  return simplify(s.normalize('NFKC').toLowerCase()).replace(/\s+/g, '');
}

/**
 * The recognition model reads a Traditional character as its Simplified
 * form more often than not — "紅血球" comes back "红血球", "計數" as "计数" —
 * while the configured names are Traditional. Both sides are folded to the
 * Simplified form before comparing. The table covers the characters that
 * occur in the configured test names, not the language; a name that adds a
 * new one may need a row here.
 */
const SIMPLIFIED: Record<string, string> = {
  紅: '红', 計: '计', 數: '数', 濃: '浓', 寬: '宽', 絕: '绝', 對: '对', 單: '单',
  鹼: '碱', 帶: '带', 狀: '状', 纖: '纤', 維: '维', 級: '级', 邊: '边', 細: '细',
  網: '网', 脫: '脱', 氫: '氢', 腎: '肾', 絲: '丝', 過: '过', 濾: '滤', 門: '门',
  轉: '转', 總: '总', 膽: '胆', 積: '积', 佈: '布', 體: '体', 檢: '检', 驗: '验',
  參: '参', 報: '报', 較: '较', 處: '处', 髓: '髓', 芽: '芽', 鈣: '钙', 鈉: '钠',
  鉀: '钾', 鎂: '镁', 磷: '磷', 蛋: '蛋', 質: '质', 醫: '医', 齡: '龄',
};
function simplify(s: string): string {
  let out = '';
  for (const ch of s) out += SIMPLIFIED[ch] ?? ch;
  return out;
}

/**
 * A row in two forms: `spaced` keeps single spaces so a number can be told
 * apart from a letter it is glued to, `compact` drops them so a name the
 * detector split in two still matches, and `map` takes a `compact` index back
 * to `spaced` so the search for the value can start where the name ended.
 */
function fold(s: string): { spaced: string; compact: string; map: number[] } {
  const spaced = simplify(s.normalize('NFKC').toLowerCase()).replace(/\s+/g, ' ').trim();
  const map: number[] = [];
  let compact = '';
  for (let i = 0; i < spaced.length; i++) {
    if (spaced[i] === ' ') continue;
    compact += spaced[i];
    map.push(i);
  }
  return { spaced, compact, map };
}

const NUMBER = /[<>]?\d+(?:\.\d+)?/g;

/**
 * The first standalone number in `text`, or null. Skips the things that look
 * like numbers on a lab report and are not the result: a reference range
 * ("4.0-6.0", "70~100"), and a date ("2024/05/06"). A "<0.5" keeps its sign
 * stripped — the form takes numbers — but a value the lab could not quantify
 * is still better shown than dropped.
 */
export function firstNumber(text: string): string | null {
  NUMBER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    // Range: "4.0-6.0", "4.0 – 6.0", "70~100", or the tail end of one.
    if (/^\s*[-–~]\s*\d/.test(after) || /[-–~]\s*$/.test(before)) continue;
    // Date: a year followed by a separator and more digits ("2024/05/06"),
    // any later component of one (preceded by a digit and a separator —
    // this also drops the "80" of "120/80", which is right: the first number
    // is the one asked for), and a dotted component whose decimal part is
    // itself followed by another ("113.05.06" is read as "113.05" then "06").
    if (/^\d{3,4}$/.test(m[0]) && /^\s*[/.-]\s*\d/.test(after)) continue;
    if (/\d\s*[/.]\s*$/.test(before)) continue;
    if (/^\s*\.\s*\d/.test(after)) continue;
    // A unit's scale, not a value: "10^3/uL", "x10~6/ul", "×100", "*1000".
    // (The "10~3" form is already caught as a range above.)
    if (/^\s*\^/.test(after) || /[x×*^]\s*$/.test(before)) continue;
    // No lab result has six or more digits before the point. What does is a
    // compact date ("20250418"), a chart number or an order id — and on a
    // row whose value column is blank, one of those was the first number
    // after the name.
    if (/^\d{6,}$/.test(m[0].replace(/^[<>]/, '').split('.')[0])) continue;
    // A clock time ("10:33"): either half of it.
    if (/^\s*:\s*\d{2}\b/.test(after) || /\d\s*:\s*$/.test(before)) continue;
    // Glued to a letter on the left ("A1c", "T4") is part of a name, not a value.
    if (/[a-z]$/i.test(before)) continue;
    return m[0].replace(/^[<>]/, '');
  }
  return null;
}

/**
 * The names a report might print for one configured name.
 *
 * The configured English names are the long, unambiguous form with the
 * abbreviations in brackets — "Hemoglobin (HGB / Hb)", "Aspartate
 * Aminotransferase (AST / GOT)" — and a report prints one of the parts, never
 * the whole. So each part is an alias: the text before the bracket, each
 * slash-separated item inside it, and, for a Latin word, its singular
 * ("Neutrophils" is printed "Neutrophil"). Chinese names split on the
 * full-width slash the same way ("血比容／紅血球容積比").
 */
export function aliasesOf(name: string): string[] {
  const out: string[] = [];
  const push = (s: string) => { const t = s.trim(); if (t) out.push(t); };
  const m = /^([^()（）]*)[(（]([^()（）]*)[)）]\s*$/.exec(name.trim());
  const head = m ? m[1] : name;
  const inner = m ? m[2] : '';
  for (const part of head.split(/[/／]/)) {
    push(part);
    const t = part.trim();
    if (/^[A-Za-z ]+s$/.test(t) && t.length >= 5) push(t.slice(0, -1));
  }
  for (const part of inner.split(/[/／,，]/)) push(part);
  return out;
}

// The units a lab prints straight after a result. Lower-case, NFKC-folded,
// as `fold` leaves the row.
const UNIT = String.raw`(?:%|g/dl|g/l|mg/dl|mg/l|u/l|iu/l|fl|pg(?:/cell)?|k/ul|m/ul|million/ul|mmol/l|umol/l|ml/min\S*|10\^?\d\s*/\s*ul|1000/ul)`;
const VALUE_THEN_UNIT_BEFORE = new RegExp(String.raw`(?:^|\s)[<>]?(\d+(?:\.\d+)?)\s*[*hl]?\s*${UNIT}\s*$`);

/**
 * A value printed *before* the name, when a unit sits between them:
 * "CRE 1.21 mg/dL 肌酸酐 0.70 1.30" is code, value, unit, Chinese name,
 * then the reference range as two bare numbers. Reading forward from the
 * Chinese name there would give 0.70. A number followed by a unit and then
 * the name is unambiguous, so it is preferred over anything after the name.
 */
export function valueBeforeName(textBefore: string): string | null {
  const m = VALUE_THEN_UNIT_BEFORE.exec(textBefore);
  return m ? m[1] : null;
}

function namesOf(field: ScanField): string[] {
  const raw = [field.display_name_en, field.display_name_zh_hant, field.display_name, ...splitAliases(field.aliases)];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of raw) {
    if (typeof n !== 'string') continue;
    for (const alias of [n, ...aliasesOf(n)]) {
      const key = normalise(alias);
      // One character matches everything; two is the floor ("Hb", "Cr", "鈣").
      if (key.length < 2 || seen.has(key)) continue;
      seen.add(key);
      out.push(alias);
    }
  }
  return out;
}

const LATIN = /^[a-z0-9.]+$/;

/**
 * Where `key` occurs in `compact`, or -1. A Latin alias must stand on its own:
 * "Hb" is not found in "HbA1c", "ALT" is not found in "ALTERNATE". A Chinese
 * name has no word boundaries and is taken wherever it appears.
 */
function findAlias(compact: string, key: string): number {
  if (!LATIN.test(key)) {
    // "絕對嗜中性白血球數" is the absolute count, a different test from
    // "嗜中性白血球" (the percentage). A Chinese name preceded by the
    // "absolute" qualifier is not that name, unless the name carries the
    // qualifier itself. (Folded to Simplified by this point.)
    let from = 0;
    for (;;) {
      const at = compact.indexOf(key, from);
      if (at < 0) return -1;
      if (!(at >= 2 && compact.slice(at - 2, at) === '绝对' && !key.startsWith('绝对'))) return at;
      from = at + 1;
    }
  }
  let from = 0;
  for (;;) {
    const at = compact.indexOf(key, from);
    if (at < 0) return -1;
    const before = compact[at - 1];
    const after = compact[at + key.length];
    if (!(before && /[a-z]/.test(before)) && !(after && /[a-z]/.test(after))) return at;
    from = at + 1;
  }
}

interface Candidate { field: ScanField; rowIndex: number; name: string; value: string; }

/**
 * Propose a value for every field whose name is found on the report.
 *
 * Where two fields claim the same row ("Cholesterol" and "HDL Cholesterol"
 * both appear in "HDL Cholesterol 1.2"), the longer name wins the row, and the
 * shorter one is free to match a different row. Each field takes its
 * top-most eligible row; each row serves one field.
 */
export function matchRows(rows: OcrRow[], fields: ScanField[]): ScanFill {
  const folded = rows.map((r) => fold(r.text));
  const candidates: Candidate[] = [];

  for (const field of fields) {
    for (const name of namesOf(field)) {
      const key = normalise(name);
      folded.forEach((row, rowIndex) => {
        const at = findAlias(row.compact, key);
        if (at < 0) return;
        // Resume in the spaced form just past the name's last character —
        // unless a value-and-unit immediately precedes the name.
        const start = row.map[at];
        const from = row.map[at + key.length - 1] + 1;
        const value = valueBeforeName(row.spaced.slice(0, start)) ?? firstNumber(row.spaced.slice(from));
        if (value !== null) candidates.push({ field, rowIndex, name, value });
      });
    }
  }

  candidates.sort((a, b) =>
    normalise(b.name).length - normalise(a.name).length || a.rowIndex - b.rowIndex);

  const values: Record<string, ScanMatch> = {};
  const takenRows = new Set<number>();
  for (const c of candidates) {
    const key = `field_${c.field.field_number}`;
    if (values[key] || takenRows.has(c.rowIndex)) continue;
    values[key] = { value: c.value, name: c.name, row: rows[c.rowIndex].text };
    takenRows.add(c.rowIndex);
  }

  const unmatched = rows
    .map((r, i) => ({ text: r.text.trim(), i }))
    .filter(({ text, i }) => text !== '' && !takenRows.has(i))
    .map(({ text }) => text);

  return { values, unmatched, testDate: detectTestDate(rows) };
}

// Gregorian "2024/05/06", "2024-5-6", "2024年5月6日"; ROC "113/05/06",
// "民國113年5月6日" — Taiwanese reports use both, sometimes on the same page.
const GREGORIAN = /(?<!\d)((?:19|20)\d{2})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?(?!\d)/;
const ROC = /(?<!\d)(1[0-2]\d)\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})\s*日?(?!\d)/;

/**
 * The first plausible date printed on the report. Reports carry several —
 * collection, receipt, report, birth — and the first in reading order is the
 * collection date often enough to be the right default and never worse than
 * today, which is what the form would otherwise show. The user sees it in the
 * date field and can change it.
 */
export function detectTestDate(rows: OcrRow[], now: Date = new Date()): Date | null {
  const thisYear = now.getFullYear();
  for (const row of rows) {
    const text = row.text.normalize('NFKC');
    let y: number | undefined, mo: number | undefined, d: number | undefined;
    const g = GREGORIAN.exec(text);
    if (g) { [y, mo, d] = [Number(g[1]), Number(g[2]), Number(g[3])]; }
    else {
      const r = ROC.exec(text);
      if (r) { [y, mo, d] = [Number(r[1]) + 1911, Number(r[2]), Number(r[3])]; }
    }
    if (y === undefined || mo === undefined || d === undefined) continue;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    // A birth date decades back is not a test date; next year is not either.
    if (y < thisYear - 5 || y > thisYear + 1) continue;
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1) continue; // 31st of a 30-day month
    return date;
  }
  return null;
}
