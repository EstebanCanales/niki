import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { SpeakerService } from "./speaker.service";
import { VoiceService } from "./voice.service";

@Module({
  imports: [CommonModule],
  providers: [VoiceService, SpeakerService],
  exports: [VoiceService, SpeakerService],
})
export class VoiceModule {}
