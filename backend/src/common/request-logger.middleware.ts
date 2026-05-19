import { Injectable, Logger, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

type RequestWithId = Request & { requestId?: string };

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger("HTTP");

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = Date.now();
    const request = req as RequestWithId;
    const externalRequestId = String(req.headers["x-request-id"] ?? "").trim();
    const requestId = externalRequestId || Math.random().toString(36).slice(2, 10);
    request.requestId = requestId;

    res.setHeader("x-request-id", requestId);
    res.setHeader("x-correlation-id", requestId);

    const isQuietNotchConsume =
      req.method === "POST" &&
      (req.originalUrl === "/notch/consume" || req.originalUrl.startsWith("/notch/consume?"));

    if (!isQuietNotchConsume) {
      this.logger.log(`[${requestId}] -> ${req.method} ${req.originalUrl}`);
    }

    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      if (isQuietNotchConsume && res.statusCode < 400) {
        return;
      }
      this.logger.log(
        `[${requestId}] <- ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`,
      );
    });

    next();
  }
}
