import { Module } from "@nestjs/common";
import { CommonModule } from "../common/common.module";
import { FaceService } from "./face.service";
import { SpeakerService } from "./speaker.service";
import { VoiceService } from "./voice.service";

@Module({
  imports: [CommonModule],
  providers: [VoiceService, SpeakerService, FaceService],
  exports: [VoiceService, SpeakerService, FaceService],
})
export class VoiceModule {}
