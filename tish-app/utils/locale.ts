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
 */
export function appLocale(): string {
  return i18next.language;
}
