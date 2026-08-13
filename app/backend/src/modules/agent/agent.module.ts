import { Module } from "@nestjs/common";

import { AgentRuntimeService } from "./agent-runtime.service";

/**
 * El runtime del agente de Niki: el fork de Hermes que vive en `app/agent-runtime/`,
 * arrancado y supervisado por el backend en vez de a mano.
 */
@Module({
  providers: [AgentRuntimeService],
  exports: [AgentRuntimeService],
})
export class AgentModule {}
