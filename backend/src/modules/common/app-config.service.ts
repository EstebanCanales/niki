import { Injectable } from "@nestjs/common";

export type AppConfig = {
  appName: string;
  port: number;
  host: string;
  internalApiKey: string;
  wrapperApiKey: string;
  publicBaseUrl: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  upstashRedisRestUrl: string;
  upstashRedisRestToken: string;
  hermesApiServerUrl: string;
  hermesApiKey: string;
  hermesModel: string;
  environment: string;
};

@Injectable()
export class AppConfigService {
  private readonly config: AppConfig = {
    appName: "niki-core-backend",
    port: Number(process.env.PORT ?? "8000"),
    host: (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    internalApiKey: String(
      process.env.INTERNAL_API_KEY ?? "dev-internal-key",
    ).trim(),
    wrapperApiKey: String(
      process.env.WRAPPER_API_KEY ?? process.env.CLAWBOT_API_KEY ?? "",
    ).trim(),
    publicBaseUrl: String(
      process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8000",
    )
      .trim()
      .replace(/\/+$/, ""),
    supabaseUrl: String(process.env.SUPABASE_URL ?? "").trim(),
    supabaseServiceRoleKey: String(
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    ).trim(),
    upstashRedisRestUrl: String(
      process.env.UPSTASH_REDIS_REST_URL ?? "",
    ).trim(),
    upstashRedisRestToken: String(
      process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
    ).trim(),
    hermesApiServerUrl: String(
      process.env.HERMES_API_SERVER_URL ?? "http://127.0.0.1:8642",
    )
      .trim()
      .replace(/\/+$/, ""),
    hermesApiKey: String(process.env.HERMES_API_KEY ?? "").trim(),
    hermesModel: String(process.env.HERMES_MODEL ?? "Hermes-4-70B").trim(),
    environment: String(process.env.NODE_ENV ?? "development").trim(),
  };

  get() {
    return this.config;
  }

  infraStatus() {
    return {
      supabase: Boolean(
        this.config.supabaseUrl && this.config.supabaseServiceRoleKey,
      ),
      upstash: Boolean(
        this.config.upstashRedisRestUrl && this.config.upstashRedisRestToken,
      ),
      hermes: Boolean(this.config.hermesApiServerUrl),
    };
  }
}
