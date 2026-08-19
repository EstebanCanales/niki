import { Module } from "@nestjs/common";

import { VoiceModule } from "../voice/voice.module";
import { IdentidadService } from "./identidad.service";

@Module({
  imports: [VoiceModule],
  providers: [IdentidadService],
  exports: [IdentidadService],
})
export class IdentidadModule {}
