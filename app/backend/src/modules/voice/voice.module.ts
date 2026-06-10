import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { VoiceService } from "./voice.service";

@Module({
  imports: [CommonModule],
  providers: [VoiceService],
  exports: [VoiceService],
})
export class VoiceModule {}
