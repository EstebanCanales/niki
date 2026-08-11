import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

interface CloudEnvironment {
  DATABASE_URL: string;
  PORT: number;
  WEB_ORIGIN: string;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<CloudEnvironment, true>) {}

  get databaseUrl(): string {
    return this.configService.getOrThrow("DATABASE_URL", { infer: true });
  }

  get port(): number {
    return this.configService.getOrThrow("PORT", { infer: true });
  }

  get webOrigin(): string {
    return this.configService.getOrThrow("WEB_ORIGIN", { infer: true });
  }
}
