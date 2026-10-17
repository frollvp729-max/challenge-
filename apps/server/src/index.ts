import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startBot } from "./bot/index.js";
import { startScheduler } from "./services/scheduler.js";

const app = await buildApp();
await app.listen({ port: config.port, host: config.host });
await startBot();
if (config.schedulerEnabled) startScheduler();
