import type { Locale } from "./i18n";

export type QuickLocale = "zh" | "en";

export function nextQuickLocale(locale: Locale): QuickLocale {
  return locale === "zh" ? "en" : "zh";
}
