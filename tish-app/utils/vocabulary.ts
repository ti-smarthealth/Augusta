/**
 * Client-side resolution of the localised vocabularies (migration 014):
 * genders, conditions and the medication library.
 *
 * **The server already resolves these** — every row arrives with a flat `name`
 * (or `med_name`, `gender_name`, …) alongside its per-locale pair. So why
 * resolve again here, for exactly the reason `announcements.ts` does: **the user
 * can change language without refetching.** `changeLanguage` swaps i18next's
 * language and re-renders, but a list already in state still holds whatever the
 * server resolved when it was fetched. Reading the pair makes the switch
 * immediate rather than leaving a medication list in the previous language until
 * something happens to reload it.
 *
 * Pure and dependency-free, like `dose-queue-policy` and `relationship-types`,
 * because **every rule here fails silently**: resolving to the wrong side shows
 * a patient a language they may not read, and resolving to nothing shows them a
 * blank where a medicine name belongs. Neither throws and neither logs — it just
 * looks like the data was entered that way.
 */

// Explicit `.ts`: node --test resolves the specifier literally, and tsconfig's
// `allowImportingTsExtensions` is what lets tsc accept the form Node requires.
import { ANNOUNCEMENT_LOCALES, type AnnouncementLocale } from './announcements.ts';

/**
 * A row carrying `<field>_en` / `<field>_zh_hant`, and possibly a flat fallback.
 *
 * Typed as `object` rather than `Record<string, unknown>` on purpose: a plain
 * interface has no index signature, so the stricter form rejects every domain
 * type the callers actually hold (`Gender`, `GeneralOption`, a reminder row)
 * and would push each of them into a cast at the call site.
 */
export type LocalisedRow = object;

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * The name of `field` in the reader's language.
 *
 * Falls back to the other language before giving up, then to the flat field the
 * server resolved — which is what keeps this working against a backend that
 * predates migration 014, where the pair does not exist at all and only the flat
 * value is present. Returns null when there is genuinely nothing, so callers can
 * show their own placeholder rather than an empty string that reads as a
 * layout bug.
 */
export function localisedName(
  row: LocalisedRow | null | undefined,
  field: string,
  locale: AnnouncementLocale,
): string | null {
  if (!row) return null;
  const bag = row as Record<string, unknown>;

  const preferred = ANNOUNCEMENT_LOCALES[locale] ? locale : 'zh-Hant';
  const other: AnnouncementLocale = preferred === 'en' ? 'zh-Hant' : 'en';

  const read = (l: AnnouncementLocale) => bag[`${field}_${ANNOUNCEMENT_LOCALES[l]}`];

  if (filled(read(preferred))) return read(preferred) as string;
  if (filled(read(other))) return read(other) as string;
  // Older backend, or a row the server already flattened.
  if (filled(bag[field])) return bag[field] as string;
  return null;
}
