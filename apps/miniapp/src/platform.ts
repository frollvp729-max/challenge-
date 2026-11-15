/**
 * Где открыто приложение: Telegram (Mini App), Max (мини-приложение) или обычный браузер.
 * Приложение одно и то же, отличаются только вход, системная кнопка «Назад» и ссылки.
 */

interface MaxBackButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

/** Мост мини-приложений Max (https://dev.max.ru/docs/webapps/bridge) */
export interface MaxWebApp {
  initData: string;
  initDataUnsafe?: { start_param?: string; user?: { id: number; first_name?: string } };
  platform?: string;
  ready?(): void;
  close?(): void;
  openLink?(url: string): void;
  openMaxLink?(url: string): void;
  BackButton?: MaxBackButton;
  HapticFeedback?: { notificationOccurred?(type: string): void };
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

/** initData Max: из моста или из адреса (#WebAppData=...), если скрипт моста не загрузился */
function readMaxInitData(): string {
  const fromBridge = window.WebApp?.initData;
  if (fromBridge) return fromBridge;
  const m = location.hash.match(/(?:^#|&)WebAppData=([^&]*)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

const maxInit = readMaxInitData();
/** Для разработки без Max: /app/?devmax=<id> (на сервере DEV_AUTH=1) */
export const devMax = new URLSearchParams(location.search).get("devmax");

export const maxInitData = () => window.WebApp?.initData || maxInit;
export const inTelegram = () => Boolean(window.Telegram?.WebApp?.initData);
export const inMax = () => !inTelegram() && (Boolean(maxInitData()) || Boolean(devMax));
/** Внутри мессенджера: вход не нужен, есть системная кнопка «Назад» */
export const inMessenger = () => inTelegram() || inMax();
export const platformName = () => (inTelegram() ? "Telegram" : inMax() ? "Max" : "сайт");

/** Стартовый параметр мини-приложения Max (max.ru/<бот>?startapp=chat_e12) → экран и участие */
export function maxStartParams(): { screen?: string; enrollment?: number } {
  if (!inMax()) return {};
  let p = window.WebApp?.initDataUnsafe?.start_param ?? "";
  if (!p) {
    try {
      p = new URLSearchParams(maxInitData()).get("start_param") ?? "";
    } catch {
      p = "";
    }
  }
  const out: { screen?: string; enrollment?: number } = {};
  for (const part of p.split("_")) {
    if (/^e\d+$/.test(part)) out.enrollment = Number(part.slice(1));
    else if (/^[a-z]+$/.test(part)) out.screen = part;
  }
  return out;
}

/** Системная кнопка «Назад» мессенджера (в браузере её нет) */
export function backButton(): MaxBackButton | null {
  if (inTelegram()) return window.Telegram!.WebApp.BackButton;
  if (inMax()) return window.WebApp?.BackButton ?? null;
  return null;
}

/** Открыть ссылку: в мессенджере его средствами, в браузере в новой вкладке */
export function openUrl(url: string) {
  const tg = window.Telegram?.WebApp;
  if (inTelegram() && tg) {
    if (url.startsWith("https://t.me/")) tg.openTelegramLink(url);
    else tg.openLink(url);
    return;
  }
  const mx = window.WebApp;
  if (inMax() && mx) {
    try {
      if (url.startsWith("https://max.ru/") && mx.openMaxLink) return mx.openMaxLink(url);
      if (mx.openLink) return mx.openLink(url);
    } catch {
      /* старая версия Max: откроем обычным способом */
    }
  }
  window.open(url, "_blank");
}

/** Своё окно вместо alert/confirm: в мини-приложениях Max системные окна браузера могут не появиться */
function dialog(message: string, withCancel: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "dlg";
    const box = document.createElement("div");
    box.className = "dlg-box";
    box.setAttribute("role", "dialog");
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "dlg-actions";
    const done = (v: boolean) => {
      wrap.remove();
      resolve(v);
    };
    if (withCancel) {
      const cancel = document.createElement("button");
      cancel.className = "btn btn-soft";
      cancel.textContent = "Отмена";
      cancel.onclick = () => done(false);
      row.append(cancel);
    }
    const ok = document.createElement("button");
    ok.className = "btn btn-primary";
    ok.textContent = "OK";
    ok.onclick = () => done(true);
    row.append(ok);
    box.append(p, row);
    wrap.append(box);
    wrap.onclick = (e) => e.target === wrap && done(false);
    document.body.append(wrap);
    ok.focus();
  });
}

export function alertMsg(msg: string) {
  const tg = window.Telegram?.WebApp;
  if (inTelegram() && tg) tg.showAlert(msg);
  else if (inMax()) void dialog(msg, false);
  else alert(msg);
}

export function confirmMsg(msg: string): Promise<boolean> {
  const tg = window.Telegram?.WebApp;
  if (inTelegram() && tg?.showConfirm) return new Promise((res) => tg.showConfirm(msg, res));
  if (inMax()) return dialog(msg, true);
  return Promise.resolve(confirm(msg));
}

export function haptic(type: "success" | "error" | "warning") {
  try {
    if (inTelegram()) window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(type);
    else if (inMax()) window.WebApp?.HapticFeedback?.notificationOccurred?.(type);
  } catch {
    /* вибрация не обязательна */
  }
}
