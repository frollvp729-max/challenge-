import { buildApp } from "./app.js";
import { config } from "./config.js";
import { logBotError, startBot } from "./bot/index.js";
import { startScheduler } from "./services/scheduler.js";
import { resolveUnmappedProducts } from "./services/payments.js";

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
// Ошибка бота (например, неверный BOT_TOKEN) не должна ронять сайт и админку
startBot().catch(logBotError);
if (config.schedulerEnabled) startScheduler();
// Покупки, пришедшие до привязки товара к челленджу, разбираем при старте
resolveUnmappedProducts().catch((err) => console.error("Tribute: разбор непривязанных покупок", err));
