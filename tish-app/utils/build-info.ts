/**
 * Which build and which JS bundle this process is actually running.
 *
 * **This exists because of a diagnosis that took two days for want of one
 * field.** A tester reported a crash, no `app.crash` event ever arrived, and
 * the question that decided everything — *is the crash reporter even in the
 * bundle on their phone?* — could not be answered from any data we had. Their
 * device was sending `app.open` the whole time; those events simply never said
 * which code produced them.
 *
 * `update_id` is the load-bearing one: **null means the embedded bundle**, the
 * JS compiled into the binary, so an OTA has never been applied. A non-null id
 * names exactly which update the device is on, and it joins to the update list
 * in EAS. Together with `app_version` that is enough to answer "does this
 * device have the fix" without asking anybody to read a settings screen.
 *
 * Never throws: it sits on the launch path and on the crash path, and both are
 * places where the telemetry contract (`telemetry.ts`, contract 1) says a
 * failure here must not become a failure there.
 */
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export interface BuildIdentity {
  platform: string;
  app_version: string | null;
  /** Null on the embedded bundle — i.e. no OTA update has ever been applied. */
  update_id: string | null;
}

export function buildIdentity(): BuildIdentity {
  try {
    return {
      platform: Platform.OS,
      app_version: Constants.expoConfig?.version ?? null,
      update_id: Updates.updateId ?? null,
    };
  } catch {
    return { platform: Platform.OS, app_version: null, update_id: null };
  }
}
