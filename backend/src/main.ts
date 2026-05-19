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

void bootstrap();
