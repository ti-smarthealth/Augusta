import i18next from '../i18n';

/**
 * The BCP-47 tag that dates, times and numbers should be formatted with.
 *
 * Always pass this to `toLocaleDateString` / `toLocaleTimeString` / `Intl`
 * rather than omitting the argument or passing `undefined` or `[]`. Omitting it
 * formats with the *device* locale, but this app's language is a stored
 * preference that is deliberately independent of the device — so a Chinese UI
 * on an English phone rendered English-formatted dates inside Chinese
 * sentences, including inside accessibility labels, where a screen reader then
 * read them out with the surrounding Chinese.
 *
 * Read from the i18next singleton rather than a hook so this works outside
 * components too. Every current caller re-renders on a language change, because
 * they all use `t` from the same instance.
 *
 * Before `initI18n` has run this returns undefined, which the `toLocale*`
 * family treats as "use the runtime default" — the behaviour these calls had
 * before. So an early call degrades to the old result rather than throwing.
 *
 * **The tag is probed against the runtime's own formatter before being handed
 * out.** Hermes's Intl is not V8's: it is a separate implementation, backed by
 * platform APIs on iOS, with a documented history of gaps — locales parsed as
 * `und`, methods going missing from a release, formatter crashes on newer iOS.
 * Every screen in this app formats a date through this function, so a tag the
 * engine rejects would turn one Intl gap into an app-wide crash on exactly one
 * platform. The probe runs the three formatter shapes the app actually uses,
 * once per language, and on any throw falls back to `undefined` — device-locale
 * formatting, the pre-migration behaviour: cosmetically wrong, functionally
 * alive.
 */
const probed = new Map<string, string | undefined>();

export function appLocale(): string | undefined {
  const lang = i18next.language;
  if (!lang) return undefined;
  if (!probed.has(lang)) {
    let usable: string | undefined = lang;
    try {
      const d = new Date(0);
      d.toLocaleDateString(lang);
      d.toLocaleDateString(lang, { weekday: 'long', month: 'long', day: 'numeric' });
      d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
      d.toLocaleString(lang, { month: 'short' });
    } catch {
      usable = undefined;
    }
    probed.set(lang, usable);
  }
  return probed.get(lang);
}
