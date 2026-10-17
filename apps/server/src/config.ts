function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Не задана переменная окружения ${name} (см. .env.example)`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  /** Публичный адрес сервера, например https://challenges.example.com */
  publicUrl: (process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  botToken: process.env.BOT_TOKEN ?? "",
  /** Имя бота без @ — для ссылок «поделиться» */
  botUsername: process.env.BOT_USERNAME ?? "",
  /** polling | webhook | off */
  botMode: (process.env.BOT_MODE ?? "polling") as "polling" | "webhook" | "off",
  /** Секрет в пути вебхука Telegram (для BOT_MODE=webhook) */
  botWebhookSecret: process.env.BOT_WEBHOOK_SECRET ?? "",
  /** API-ключ Tribute: им подписываются вебхуки (заголовок trbt-signature) */
  tributeApiKey: process.env.TRIBUTE_API_KEY ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  /** Разрешить вход в Mini App без Telegram по заголовку x-dev-user (только для локальной разработки!) */
  devAuth: process.env.DEV_AUTH === "1",
  uploadsDir: process.env.UPLOADS_DIR ?? "./uploads",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "Europe/Moscow",
  schedulerEnabled: process.env.SCHEDULER !== "off",
  get webAppUrl() {
    return `${this.publicUrl}/app/`;
  },
  require: req,
};
