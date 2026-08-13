import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";

import { AuditModule } from "./modules/audit/audit.module";
import { CommonModule } from "./modules/common/common.module";
import { ComplianceModule } from "./modules/compliance/compliance.module";
import { HealthModule } from "./modules/health/health.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { RuntimeModule } from "./modules/runtime/runtime.module";
import { AgentModule } from "./modules/agent/agent.module";
import { VoiceModule } from "./modules/voice/voice.module";
import { RequestLoggerMiddleware } from "./common/request-logger.middleware";
import { WrapperModule } from "./wrapper/wrapper.module";

@Module({
  imports: [
    CommonModule,
    HealthModule,
    IdentityModule,
    ComplianceModule,
    AuditModule,
    RuntimeModule,
    AgentModule,
    VoiceModule,
    WrapperModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes("*");
  }
}
