import { prisma } from "../lib/db.js";

/** Реквизиты для перевода на карту (заполняются в админке → «Платежи») */
export interface CardSettings {
  number: string;
  holder: string;
  bank: string;
  note: string;
}

const KEYS = { number: "card.number", holder: "card.holder", bank: "card.bank", note: "card.note" } as const;

export async function getCardSettings(): Promise<CardSettings> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const v = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  return { number: v(KEYS.number), holder: v(KEYS.holder), bank: v(KEYS.bank), note: v(KEYS.note) };
}

export async function saveCardSettings(s: Partial<CardSettings>) {
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof CardSettings, string]>) {
    if (s[field] === undefined) continue;
    const value = String(s[field]).trim().slice(0, field === "note" ? 500 : 80);
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }
}

/** Оплата на карту включена, когда указан номер карты (или телефон для СБП) */
export const cardEnabled = (s: CardSettings) => s.number.length > 0;
