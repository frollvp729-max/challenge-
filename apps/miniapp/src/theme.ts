import type { IconWeight } from "@phosphor-icons/react";

/** Оформление «Стекло»: начертание иконок и цвет шапки Telegram */
export const theme: { iconWeight: IconWeight; tabWeight: IconWeight; chrome: string } = {
  // иконки в плитках и списках
  iconWeight: "fill",
  // иконки нижнего меню (активная вкладка всегда залитая)
  tabWeight: "regular",
  // шапка, фон и нижняя панель Telegram под цвет приложения
  chrome: "#eef1f6",
};

export function applyTheme() {
  const tg = window.Telegram?.WebApp;
  if (!tg) return;
  // старые клиенты Telegram умеют не всё, поэтому каждый вызов отдельно
  for (const set of [tg.setHeaderColor, tg.setBackgroundColor, tg.setBottomBarColor]) {
    try {
      set?.call(tg, theme.chrome);
    } catch {
      // метод не поддерживается этой версией Telegram
    }
  }
}
