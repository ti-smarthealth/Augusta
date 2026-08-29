import { Platform } from 'react-native';

export const SOUND_MAP: Record<string, any> = {
  'coffee_time': require('@/assets/sounds/coffee_time.mp3'),
  'digital_bounce': require('@/assets/sounds/digital_bounce.mp3'),
  'good_morning_melody': require('@/assets/sounds/good_morning_melody.mp3'),
  'mission_start': require('@/assets/sounds/mission_start.mp3'),
  'morning_chime': require('@/assets/sounds/morning_chime.mp3'),
  'ready_set_go': require('@/assets/sounds/ready_set_go.mp3'),
  'sunrise_spark': require('@/assets/sounds/sunrise_spark.mp3'),
  'wake_up_steps': require('@/assets/sounds/wake_up_steps.mp3'),
};

export const SOUND_OPTIONS = [
  { labelKey: 'sounds.morningChime', value: 'morning_chime', icon: 'bell-outline' },
  { labelKey: 'sounds.goodMorningMelody', value: 'good_morning_melody', icon: 'music-note' },
  { labelKey: 'sounds.sunriseSpark', value: 'sunrise_spark', icon: 'weather-sunset-up' },
  { labelKey: 'sounds.coffeeTime', value: 'coffee_time', icon: 'coffee-outline' },
  { labelKey: 'sounds.wakeUpSteps', value: 'wake_up_steps', icon: 'shoe-print' },
  { labelKey: 'sounds.digitalBounce', value: 'digital_bounce', icon: 'sine-wave' },
  { labelKey: 'sounds.missionStart', value: 'mission_start', icon: 'rocket-launch-outline' },
  { labelKey: 'sounds.readySetGo', value: 'ready_set_go', icon: 'flag-checkered' },
] as const;

export const DEFAULT_SOUND_KEY = 'morning_chime';

/**
 * The three keys this used to offer, mapped to their nearest replacement.
 *
 * `reminder_sound` is a free-text column (`backend/index.mjs`, DEFAULT
 * `'default'`), so rows written before the sound library was replaced still
 * hold `default` / `emergency` / `calm`. Every lookup below falls back to
 * `DEFAULT_SOUND_KEY` on an unknown key, so those rows are never *broken* — but
 * without this they would all collapse onto one sound and quietly discard a
 * choice the user had made. Resolving them keeps the picker showing the
 * closest match until the row is next saved.
 */
const LEGACY_SOUND_KEYS: Record<string, string> = {
  'default': 'morning_chime',
  'emergency': 'mission_start',
  'calm': 'good_morning_melody',
};

/** Normalises any stored key — current, legacy or unrecognised — to a real one. */
export function resolveSoundKey(soundKey?: string | null): string {
  if (!soundKey) return DEFAULT_SOUND_KEY;
  if (soundKey in SOUND_MAP) return soundKey;
  return LEGACY_SOUND_KEYS[soundKey] ?? DEFAULT_SOUND_KEY;
}

/**
 * Notification sound filenames, bundled natively by `plugins/with-platform-sounds`.
 *
 * These are deliberately *not* the SOUND_MAP files above. The app has two
 * unrelated sound paths: SOUND_MAP feeds expo-audio inside AlarmOverlay, which
 * only plays while the app is foregrounded, whereas these are played by the OS
 * on delivery with the app closed. That path has constraints the overlay does
 * not:
 *
 *  - **The two platforms accept disjoint formats, so the extension differs.**
 *    iOS will not play MP3, Vorbis or AAC as a notification sound — it takes
 *    Linear PCM, IMA4/ADPCM, µLaw or aLaw in .wav/.aiff/.caf only, and
 *    silently substitutes the default chime for anything else. Android cannot
 *    open Core Audio Format at all. So iOS gets `.caf` (IMA4) and Android gets
 *    `.ogg` (Vorbis); see the plugin for why that split cannot live in
 *    `app.json`'s `expo-notifications` block. Both share one basename, which is
 *    what lets a single key derive either name.
 *  - **Android copies these into res/raw, where filenames become Java
 *    identifiers.** The `alarm_` prefix keeps them clear of reserved words —
 *    the previous `default.wav` would have generated `R.raw.default` and failed
 *    the build outright.
 *  - **iOS caps notification sounds at 30 seconds**, falling back to the
 *    default beyond that. The longest of these runs 18.3s.
 */
export const NOTIFICATION_SOUND_EXTENSION = Platform.OS === 'ios' ? 'caf' : 'ogg';

export function notificationSoundFile(soundKey?: string | null): string {
  return `alarm_${resolveSoundKey(soundKey)}.${NOTIFICATION_SOUND_EXTENSION}`;
}

/**
 * Android wants the res/raw resource name, which is the filename with the
 * extension dropped. Derived rather than written out so it cannot drift from
 * `notificationSoundFile` when the encoding changes again.
 */
export function androidSoundResource(soundKey?: string | null): string {
  return notificationSoundFile(soundKey).replace(/\.[^.]+$/, '');
}

/**
 * Android attaches sound to the *channel*, not the notification — the `sound`
 * field on an individual notification is ignored from API 26 up. So a
 * per-reminder sound choice needs one channel per sound, selected at schedule
 * time.
 *
 * A channel's sound is fixed when the channel is first created and cannot be
 * changed by a later app update, so a changed sound always needs a new channel
 * id. That is already satisfied here: replacing the old three-sound library
 * changed every key, and the ids are derived from the key — no device has seen
 * `medication-alarms-morning_chime`. The stale `medication-alarms-default`,
 * `-emergency` and `-calm` channels are deleted in `setupNotificationChannels`
 * rather than left to sit in the user's notification settings.
 */
export function channelIdForSound(soundKey?: string | null): string {
  return `medication-alarms-${resolveSoundKey(soundKey)}`;
}

/** Channel ids from the retired three-sound library, deleted on next launch. */
export const RETIRED_CHANNEL_IDS = [
  'medication-alarms',
  'medication-alarms-default',
  'medication-alarms-emergency',
  'medication-alarms-calm',
];
