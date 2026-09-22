/**
 * The device half of report scanning. See ocr/README.md for the whole
 * pipeline; the short version is that the photo goes to S3 through a URL the
 * API signs, the OCR function reacts to the upload and writes a JSON result
 * beside it, and this module polls for that result through the second signed
 * URL. Nothing here talks to the database, and nothing here decides what a
 * value means — `ocr-match.ts` proposes, the form shows, the user saves.
 *
 * Every artefact of a scan is short-lived by construction: the upload is
 * deleted by the function the moment it has read it, the result is swept
 * within the hour, and the two URLs expire in fifteen minutes.
 */

import { MOCK } from '../constants/config';
import { apiRequest } from './api';
import { describeApiFailure, type ApiFailure } from './api-errors';
import type { OcrRow } from './ocr-match';

export type ScanStage = 'preparing' | 'uploading' | 'reading';

export interface ScanResult {
  jobId: string;
  rows: OcrRow[];
  /** Milliseconds the OCR function spent, for the console — not shown. */
  elapsedMs?: number;
}

/** Why a scan did not produce a result. `failure` is set for API refusals. */
export class ScanError extends Error {
  constructor(
    public readonly reason: 'api' | 'upload' | 'timeout' | 'engine',
    message: string,
    public readonly failure?: ApiFailure,
  ) {
    super(message);
  }
}

// How long to wait for the OCR function. A cold container is ~3s, a page of
// dense text ~8s, so a minute is generous; it is the ceiling, not the norm.
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 75_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Photograph → rows of text. `imageUri` is a local JPEG the caller has already
 * downscaled (see `results-form.tsx`); `onStage` lets the screen say which
 * step it is on, since the whole thing takes ten seconds or so.
 */
export async function scanReport(
  imageUri: string,
  onStage: (stage: ScanStage) => void = () => {},
): Promise<ScanResult> {
  if (MOCK) return mockScan(onStage);

  onStage('preparing');
  const ticket = await apiRequest('/ocr/scans', { method: 'POST', body: {} });
  if (!ticket.ok) {
    const failure = await describeApiFailure(ticket);
    throw new ScanError('api', `POST /ocr/scans → ${ticket.status}`, failure);
  }
  const { jobId, uploadUrl, resultUrl } = (await ticket.json()) as {
    jobId: string; uploadUrl: string; resultUrl: string;
  };

  onStage('uploading');
  // `fetch` on a file:// URI yields the bytes on native; on web the picker
  // hands back a blob: URI that resolves the same way. Either way this is a
  // plain PUT to S3 with the exact content type the URL was signed for.
  const blob = await (await fetch(imageUri)).blob();
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!put.ok) throw new ScanError('upload', `upload → ${put.status}`);

  onStage('reading');
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    // Missing key: 404 if the signer may list the bucket, 403 if not. Both
    // mean "not yet"; anything else is an actual problem.
    const res = await fetch(resultUrl, { cache: 'no-store' });
    if (res.status === 404 || res.status === 403) continue;
    if (!res.ok) throw new ScanError('engine', `result → ${res.status}`);
    const doc = await res.json();
    if (doc.status === 'error') throw new ScanError('engine', doc.message ?? 'OCR failed');
    return {
      jobId,
      rows: Array.isArray(doc.rows) ? doc.rows.map((r: { text?: unknown }) => ({ text: String(r.text ?? '') })) : [],
      elapsedMs: doc.elapsedMs,
    };
  }
  throw new ScanError('timeout', 'no result within the time allowed');
}

/**
 * Fixture mode: the shape of a real Taiwanese report, matching the mock
 * `/test-config`, so the review flow can be walked offline and in the
 * accessibility scan. Both names for two fields, one field by Chinese name
 * only, one deliberately absent.
 */
async function mockScan(onStage: (stage: ScanStage) => void): Promise<ScanResult> {
  onStage('preparing'); await sleep(200);
  onStage('uploading'); await sleep(300);
  onStage('reading'); await sleep(600);
  return {
    jobId: 'mock-job',
    rows: [
      { text: '臺北市立聯合醫院 檢驗報告' },
      { text: '姓名 王小明 病歷號 00123456' },
      { text: '採檢日期 2026/09/15 08:12' },
      { text: '項目 結果 單位 參考值' },
      { text: '空腹血糖 Glucose AC 98 mg/dL 70-100' },
      { text: '糖化血色素 HbA1c 6.4 % 4.0-6.0' },
      { text: '總膽固醇 5.1 mmol/L <5.2' },
      { text: 'Creatinine 1.1 mg/dL 0.7-1.3' },
    ],
    elapsedMs: 0,
  };
}
