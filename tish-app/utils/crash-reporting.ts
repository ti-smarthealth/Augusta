/**
 * A crash's last words, recorded where somebody can read them.
 *
 * This exists because of a real incident: build 12 crashed on a tester's
 * phone, and the TestFlight crash log carried only the native side of the
 * story — `RCTFatal` aborting the process — while the JavaScript error that
 * caused it died with the process. The investigation had to be conducted by
 * diffing candidate call sites. One `app.crash` event with a message and a
 * stack would have answered it in a minute.
 *
 * Routed through the telemetry buffer (TELEMETRY.md §1: operational fact, not
 * a care fact), which is what makes it crash-safe: `record()` persists to
 * AsyncStorage, so even when the flush below loses the race against the
 * process aborting, the event survives on disk and flushes on the *next*
 * launch. The immediate flush is an optimisation, not the mechanism.
 *
 * Deliberately does not swallow the error: the previous handler — the one
 * that shows the dev redbox and, in production, takes the process down — is
 * always called. A crash reporter that turns fatal errors into silent
 * continuation would be repairing the symptom by installing a worse disease.
 */
import { record, flushTelemetry } from './telemetry';

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface ErrorUtilsLike {
  getGlobalHandler?: () => GlobalErrorHandler | undefined;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
}

/** How long the crash path will wait for the flush before proceeding. */
const FLUSH_GRACE_MS = 800;

let installed = false;

export function installCrashReporter(): void {
  // Native only. On web there is no ErrorUtils and no process abort — the
  // browser console already keeps the stack alive.
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (installed || !errorUtils?.setGlobalHandler) return;
  installed = true;

  const previous = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    const proceed = () => {
      try { previous?.(error, isFatal); } catch { /* the crash path must not crash */ }
    };

    try {
      const err = error instanceof Error ? error : new Error(String(error));
      record('app.crash', {
        fatal: isFatal === true,
        // Truncated so one event stays well inside Firehose's 5KB billing
        // record; the first lines of a stack are the ones that matter.
        message: String(err.message ?? '').slice(0, 300),
        stack: String(err.stack ?? '').slice(0, 1800),
      });

      // Best effort: the POST races the abort and often loses. The bounded
      // wait raises the odds without ever hanging the crash path; the
      // AsyncStorage copy is the guarantee either way.
      const grace = new Promise<void>((resolve) => setTimeout(resolve, FLUSH_GRACE_MS));
      Promise.race([flushTelemetry(), grace]).then(proceed, proceed);
    } catch {
      proceed();
    }
  });
}
