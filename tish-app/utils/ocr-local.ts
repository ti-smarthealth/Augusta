/**
 * On-device report scanning, beside the cloud path in `ocr.ts`.
 *
 * Google ML Kit's text recogniser runs entirely on the phone: no upload, no
 * Lambda, nothing leaves the device, and the result is back in a second or
 * two. It is here **as a second button for side-by-side testing** against
 * the cloud engine on the same photos, not as a replacement: iOS handles
 * Traditional Chinese well, Android's Chinese model is weaker on dense
 * medical text, and the cloud engine's PP-OCR models were chosen for exactly
 * that script. Which one wins on real reports is what the test decides.
 *
 * The output is the same `ScanResult` the cloud path returns — rows of text,
 * grouped by `ocr-rows.ts`, the port of the function's own grouping — so the
 * matcher, the form and the review step are identical from here on. Only
 * the engine differs.
 *
 * **The native module is imported lazily.** Every install before this
 * module shipped lacks it, and a top-level import would throw the moment the
 * results form loaded. Imported on the button press instead, the failure is
 * one caught error with a message, on a feature the old build never showed.
 */

import { Platform } from 'react-native';
import { MOCK } from '../constants/config';
import { ScanError, type ScanResult, type ScanStage } from './ocr';
import { groupRows, lineFromCorners, lineFromFrame, type OcrLine } from './ocr-rows';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scanReportLocally(
  imageUri: string,
  onStage: (stage: ScanStage) => void = () => {},
): Promise<ScanResult> {
  if (MOCK) return mockLocalScan(onStage);
  if (Platform.OS === 'web') throw new ScanError('engine', 'on-device recognition is not available on the web');

  onStage('reading');
  const t0 = Date.now();
  let TextRecognition: typeof import('@react-native-ml-kit/text-recognition').default;
  let TextRecognitionScript: typeof import('@react-native-ml-kit/text-recognition').TextRecognitionScript;
  try {
    ({ default: TextRecognition, TextRecognitionScript } = await import('@react-native-ml-kit/text-recognition'));
  } catch (e) {
    throw new ScanError('engine', `on-device recogniser unavailable in this build: ${String(e)}`);
  }

  let result;
  try {
    // The Chinese script model also reads Latin, which a Taiwanese report
    // needs on the same line ("糖化血色素 HbA1c 6.5").
    result = await TextRecognition.recognize(imageUri, TextRecognitionScript.CHINESE);
  } catch (e) {
    throw new ScanError('engine', `on-device recognition failed: ${String(e)}`);
  }

  const lines: OcrLine[] = [];
  for (const block of result.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.cornerPoints && line.cornerPoints.length === 4) {
        lines.push(lineFromCorners(line.cornerPoints, line.text));
      } else if (line.frame) {
        lines.push(lineFromFrame(line.frame, line.text));
      }
    }
  }

  return { jobId: `local-${t0}`, rows: groupRows(lines), elapsedMs: Date.now() - t0 };
}

/**
 * Fixture mode: the same report as the cloud fixture, with one reading
 * deliberately different (HbA1c 6.5 rather than 6.4) so a side-by-side test
 * in the mock app visibly comes from a different engine.
 */
async function mockLocalScan(onStage: (stage: ScanStage) => void): Promise<ScanResult> {
  onStage('reading'); await sleep(400);
  return {
    jobId: 'mock-local',
    rows: [
      { text: '臺北市立聯合醫院 檢驗報告' },
      { text: '採檢日期 2026/09/15 08:12' },
      { text: '空腹血糖 Glucose AC 98 mg/dL 70-100' },
      { text: '糖化血色素 HbA1c 6.5 % 4.0-6.0' },
      { text: '總膽固醇 5.1 mmol/L <5.2' },
    ],
    elapsedMs: 0,
  };
}
