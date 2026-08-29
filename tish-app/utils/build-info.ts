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

/**
 * The same facts, shaped for the About screen.
 *
 * **The revision is the point of this.** Asking a tester "have you got the
 * fix?" is unanswerable from anything they can see — the app version does not
 * move when JS ships over the air, so two phones reading `1.1.0` can be running
 * code a week apart. The revision is the first segment of the update id, short
 * enough to read down a phone line, and it changes with every publish. `—`
 * means the embedded bundle: the JS compiled into the binary, no update
 * applied.
 */
export interface BuildSummary {
  appVersion: string | null;
  nativeBuild: string | null;
  /** Short update id, or null when running the embedded bundle. */
  revision: string | null;
  isEmbedded: boolean;
  updatedAt: Date | null;
  channel: string | null;
  runtimeVersion: string | null;
}

export function buildSummary(): BuildSummary {
  const safe = <T,>(read: () => T, fallback: T): T => {
    try { return read(); } catch { return fallback; }
  };

  const updateId = safe(() => Updates.updateId, null);

  return {
    appVersion: safe(() => Constants.expoConfig?.version ?? null, null),
    // Deprecated in expo-constants but still the only build number available
    // without adding expo-application as a dependency — which could not be used
    // from an over-the-air update anyway, since it needs a native rebuild.
    nativeBuild: safe(() => (Constants as { nativeBuildVersion?: string | null }).nativeBuildVersion ?? null, null),
    revision: updateId ? updateId.split('-')[0] : null,
    isEmbedded: safe(() => Updates.isEmbeddedLaunch, true),
    updatedAt: safe(() => Updates.createdAt, null),
    channel: safe(() => Updates.channel, null),
    runtimeVersion: safe(() => Updates.runtimeVersion, null),
  };
}
