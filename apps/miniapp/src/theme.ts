import type { IconWeight } from "@phosphor-icons/react";

export type ThemeName = "calm" | "glass" | "energy";

interface ThemeConfig {
  /** Начертание иконок в плитках и списках */
  iconWeight: IconWeight;
  /** Начертание иконок нижнего меню */
  tabWeight: IconWeight;
  /** Цвет шапки и фона Telegram под тему */
  chrome: string;
}

export const THEMES: Record<ThemeName, ThemeConfig> = {
  calm: { iconWeight: "duotone", tabWeight: "regular", chrome: "#f1eee8" },
  glass: { iconWeight: "fill", tabWeight: "regular", chrome: "#eef1f6" },
  energy: { iconWeight: "bold", tabWeight: "bold", chrome: "#0d0e0b" },
};

// Для сравнения вариантов тему можно выбрать параметром ?theme=
const param = new URLSearchParams(location.search).get("theme");
export const themeName: ThemeName = param && param in THEMES ? (param as ThemeName) : "calm";
export const theme = THEMES[themeName];

export function applyTheme() {
  document.documentElement.dataset.theme = themeName;
  const tg = window.Telegram?.WebApp;
  try {
    tg?.setHeaderColor?.(theme.chrome);
    tg?.setBackgroundColor?.(theme.chrome);
    tg?.setBottomBarColor?.(theme.chrome);
  } catch {
    // старые клиенты Telegram не умеют задавать цвета
  }
}
