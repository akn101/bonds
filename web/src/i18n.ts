import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import dayjs from "dayjs";
import updateLocale from "dayjs/plugin/updateLocale";
import "dayjs/locale/zh-cn";
import "dayjs/locale/es";
import "dayjs/locale/fr";
import "dayjs/locale/de";
import "dayjs/locale/pt";
import en from "./locales/en.json";
import zh from "./locales/zh.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import de from "./locales/de.json";
import ptBR from "./locales/pt-BR.json";
import ptPT from "./locales/pt-PT.json";

// Translation resources are the frontend source of truth for supported locale
// codes. Labels and library adapters below are typed Records, so TypeScript
// fails the build when a new bundle is not wired through every consumer.
const TRANSLATION_RESOURCES = {
  en: { translation: en },
  zh: { translation: zh },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  "pt-BR": { translation: ptBR },
  "pt-PT": { translation: ptPT },
} as const;

export type SupportedLanguageCode = keyof typeof TRANSLATION_RESOURCES;
export const DEFAULT_LANGUAGE: SupportedLanguageCode = "en";

const LANGUAGE_LABELS: Record<SupportedLanguageCode, string> = {
  en: "English",
  zh: "中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  "pt-BR": "Português (BR)",
  "pt-PT": "Português (PT)",
};

export const SUPPORTED_LANGUAGES: readonly {
  code: SupportedLanguageCode;
  label: string;
}[] = (Object.keys(TRANSLATION_RESOURCES) as SupportedLanguageCode[]).map(
  (code) => ({ code, label: LANGUAGE_LABELS[code] }),
);

// When a bare primary code (e.g. "pt") is not itself a supported language but
// should resolve to a region-specific variant, list it here with its target.
const REGION_FALLBACKS: Record<string, SupportedLanguageCode> = {
  pt: "pt-PT",
};

// Reduce a full BCP-47 tag (e.g. "zh-CN", "zh-Hans") to a code we actually
// load resources for, so what we send the backend in `Accept-Language` always
// matches the locale the seed/sync routines understand.
// For region-specific bundles (pt-BR, pt-PT) the full lowercased tag is tried
// first before falling back to the primary subtag, then to region fallbacks.
// Matching is case-insensitive: the canonical codes use uppercase region
// ("pt-BR"), matching i18next's normalization of "pt-br" → "pt-BR".
export function normalizeLanguageCode(language: string | undefined): SupportedLanguageCode {
  if (!language) return DEFAULT_LANGUAGE;
  const lower = language.toLowerCase();
  // Try exact case-insensitive match (e.g. "pt-br" → "pt-BR", "pt-BR" → "pt-BR")
  const exact = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === lower);
  if (exact) return exact.code;
  // Check region fallbacks (e.g. "pt" → "pt-PT")
  if (REGION_FALLBACKS[lower]) return REGION_FALLBACKS[lower];
  // Fall back to primary subtag (e.g. "zh-CN" → "zh")
  const primary = lower.split("-")[0];
  const match = SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === primary);
  return match ? match.code : DEFAULT_LANGUAGE;
}

// dayjs uses lowercase locale tags with hyphens; ours come from i18next.
// Without this mapping every dayjs(...).format("MMMM") would emit English
// month names even when the rest of the UI is in zh/es.
// Both pt-br and pt-pt share dayjs's generic "pt" locale.
const DAYJS_LOCALES: Record<SupportedLanguageCode, string> = {
  en: "en",
  zh: "zh-cn",
  es: "es",
  fr: "fr",
  de: "de",
  "pt-BR": "pt",
  "pt-PT": "pt",
};

dayjs.extend(updateLocale);

export type WeekStartPreference = "sunday" | "monday";

export function applyDayjsWeekStart(weekStart: WeekStartPreference | string | undefined) {
  const firstDay = weekStart === "monday" ? 1 : 0;
  for (const localeName of Object.values(DAYJS_LOCALES)) {
    dayjs.updateLocale(localeName, { weekStart: firstDay });
  }
}

function syncDayjsLocale(code: string) {
  dayjs.locale(DAYJS_LOCALES[normalizeLanguageCode(code)]);
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: TRANSLATION_RESOURCES,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: {
      escapeValue: false,
    },
  });

// Apply once at boot and re-apply on every change so DatePicker month names,
// relative-time strings, etc. stay in step with the active language. Without
// this listener, switching from English to 中文 leaves dayjs stuck on English
// until the page reloads.
applyDayjsWeekStart("sunday");
syncDayjsLocale(i18n.language);
i18n.on("languageChanged", syncDayjsLocale);

export default i18n;
