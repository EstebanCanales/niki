import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useBodyParser("json", { limit: "10mb" });
  app.useBodyParser("urlencoded", { limit: "10mb", extended: true });

  app.enableCors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Idempotency-Key",
      "x-niki-api-key",
      "x-internal-api-key",
      "x-niki-user-id",
      "x-request-id",
    ],
  });

  // Sin esto, OnModuleDestroy nunca corre al recibir SIGTERM/SIGINT y el runtime del
  // agente queda huérfano: el backend se va y su proceso hijo sigue vivo ocupando el
  // puerto. Verificado — pasaba exactamente eso.
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? "8000");
  const host = (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1";

  if (process.env.NIKI_NO_LISTEN === "1") {
    logger.log("NIKI_NO_LISTEN=1, skipping HTTP listen");
    await app.init();
    return;
  }

  await app.listen(port, host);
  logger.log(`Niki core backend listening on ${host}:${port}`);
}

// Estabilidad: nunca dejar morir el proceso por errores no manejados.
const stabilityLogger = new Logger("Process");
process.on("unhandledRejection", (reason) => {
  stabilityLogger.error(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
});
process.on("uncaughtException", (error) => {
  stabilityLogger.error(`Uncaught exception: ${error instanceof Error ? error.stack : String(error)}`);
});

void bootstrap();
