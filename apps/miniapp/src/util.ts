const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function humanDate(date: string) {
  return `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

export function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export function countdown(ms: number) {
  if (ms <= 0) return "0 дней 00:00:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d} ${plural(d, "день", "дня", "дней")} ${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function haptic(type: "success" | "error" | "warning") {
  window.Telegram?.WebApp.HapticFeedback?.notificationOccurred(type);
}

export function alertMsg(msg: string) {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData) tg.showAlert(msg);
  else alert(msg);
}

export function openTgLink(url: string) {
  const tg = window.Telegram?.WebApp;
  if (tg?.initData && url.startsWith("https://t.me/")) tg.openTelegramLink(url);
  else if (tg?.initData) tg.openLink(url);
  else window.open(url, "_blank");
}

/** Сжать фото перед загрузкой (длинная сторона до 1600px, JPEG) */
export async function compressImage(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

export const GOALS: Array<[string, string]> = [
  ["lose_weight", "похудеть"],
  ["habit", "избавиться от привычки"],
  ["nutrition", "улучшить питание"],
  ["willpower", "проверить силу воли"],
  ["other", "другое"],
];
