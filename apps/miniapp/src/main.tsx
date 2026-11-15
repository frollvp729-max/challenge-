import { createRoot } from "react-dom/client";
import "@fontsource-variable/onest";
import { App } from "./App";
import { applyTheme } from "./theme";
import "./styles.css";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();
// мост мини-приложений Max (если открыто в Max)
try {
  window.WebApp?.ready?.();
} catch {
  /* старая версия Max */
}
applyTheme();

createRoot(document.getElementById("root")!).render(<App />);
