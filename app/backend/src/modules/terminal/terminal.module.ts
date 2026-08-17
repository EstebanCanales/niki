import { Module } from "@nestjs/common";

import { TerminalCompartidaService } from "./terminal-compartida.service";

@Module({
  providers: [TerminalCompartidaService],
  exports: [TerminalCompartidaService],
})
export class TerminalModule {}
