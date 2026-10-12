import { useState } from "react";

import { app } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { nextQuickLocale, type QuickLocale } from "../lib/languageToggle";
import { useToast } from "../lib/toast";

export function LanguageToggleButton({
  className = "sidebar__language-button",
  persistLanguage = (language) => app.SetDesktopLanguage(language),
}: {
  className?: string;
  persistLanguage?: (language: QuickLocale) => Promise<void>;
}) {
  const { locale, setPref, t } = useI18n();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const next = nextQuickLocale(locale);
  const label = locale === "en" ? "EN" : "中";
  const accessibleLabel = next === "en"
    ? t("sidebar.languageSwitchToEnglish")
    : t("sidebar.languageSwitchToChinese");

  const switchLanguage = async () => {
    if (busy) return;
    const previous = locale;
    setBusy(true);
    setPref(next);
    try {
      await persistLanguage(next);
    } catch {
      setPref(previous);
      showToast(t("sidebar.languageSwitchFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      disabled={busy}
      onClick={() => void switchLanguage()}
    >
      <span aria-hidden="true">{label}</span>
    </button>
  );
}
