import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api";
import { applyDayjsWeekStart, normalizeLanguageCode } from "@/i18n";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";

// Pull the persisted UI language from /api/settings/preferences and apply it
// to i18next when it differs from the active language. Without this hook,
// a user who set their language to zh in Preferences would still see English
// on the next visit until they manually clicked the LanguageSwitcher — the
// browser-language-detector would re-detect the OS locale at every boot.
//
// Mount once at the top of the authenticated tree (Layout). The query is
// gated on `user` so unauthenticated routes (login, register) don't fire it.
export function usePreferencesSync() {
  const { i18n } = useTranslation();
  const { user } = useAuth();
  const { applyThemeMode } = useTheme();
  const { data } = useQuery({
    enabled: !!user,
    queryKey: ["settings", "preferences"],
    queryFn: async () => {
      const res = await api.preferences.preferencesList();
      return res.data!;
    },
  });
  useEffect(() => {
    if (!data?.locale) return;
    const desired = normalizeLanguageCode(data.locale);
    if (i18n.language !== desired) {
      void i18n.changeLanguage(desired);
    }
  }, [data?.locale, i18n]);

  useEffect(() => {
    applyDayjsWeekStart(data?.week_start);
  }, [data?.week_start]);

  useEffect(() => {
    if (
      data?.theme === "light" ||
      data?.theme === "dark" ||
      data?.theme === "system"
    ) {
      applyThemeMode(data.theme);
    }
  }, [applyThemeMode, data?.theme]);
}
