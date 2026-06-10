import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Logger,
  Patch,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";

import { VoiceService } from "../modules/voice/voice.service";
import type { ChatRequestDto } from "./wrapper.types";
import { WrapperService } from "./wrapper.service";

type NotchDebugRequestDto = {
  text?: string;
  createdAt?: string;
  files?: Array<{
    name?: string;
    path?: string;
    kind?: string;
  }>;
};

@Controller()
export class WrapperController {
  private readonly logger = new Logger(WrapperController.name);

  constructor(
    @Inject(WrapperService) private readonly wrapperService: WrapperService,
    @Inject(VoiceService) private readonly voiceService: VoiceService,
  ) {}

  @Get("healthz")
  healthz(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.healthz(req);
  }

  @Get("config/public")
  configPublic(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.publicConfig();
  }

  @Get("runtime/config")
  runtimeConfig(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeConfig();
  }

  @Post("runtime/config")
  @HttpCode(200)
  updateRuntimeConfig(
    @Req() req: Request,
    @Body()
    body: {
      apiServerUrl?: string;
      apiKey?: string;
      model?: string;
      contextLengthOverride?: number | string | null;
      compatibilityMode?: string;
      diagnosticsEnabled?: boolean;
      provider?: string;
    },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.updateRuntimeConfig(body);
  }

  @Get("computer/capabilities")
  computerCapabilities(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.computerCapabilities();
  }

  @Get("computer/config")
  computerConfig(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.computerConfig();
  }

  @Post("computer/config")
  @HttpCode(200)
  updateComputerConfig(
    @Req() req: Request,
    @Body() body: { mode?: string; allowedRoots?: string[] },
  ) {
    this.wrapperService.assertTrustedOrigin(req);
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.updateComputerConfig(body);
  }

  @Get("computer/recent")
  computerRecent(@Req() req: Request, @Query("limit") limit?: string) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.computerRecent(limit ? Number(limit) : undefined);
  }

  @Post("computer/action")
  @HttpCode(200)
  async computerAction(
    @Req() req: Request,
    @Body() body: { action?: string; params?: Record<string, unknown> },
  ) {
    this.wrapperService.assertTrustedOrigin(req);
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.computerAction(req, body);
  }

  @Get("runtime/status")
  runtimeStatus(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeStatus();
  }

  @Get("runtime/events")
  runtimeEvents(@Req() req: Request, @Res() res: Response) {
    this.wrapperService.assertRuntimeEventsAuthorized(req);
    return this.wrapperService.streamRuntimeEvents(req, res);
  }

  @Post("chat/stream")
  @HttpCode(200)
  chatStream(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: ChatRequestDto,
  ) {
    this.logger.log(
      `[wrapper] chat/stream received session=${String(body.sessionId ?? "session")} channel=${String(
        body.channel ?? "niki-agent",
      )} inputChars=${String(body.input ?? "").length} messages=${body.messages?.length ?? 0}`,
    );
    this.wrapperService.assertTrustedOrigin(req);
    this.wrapperService.assertAuthorized(req);
    this.logger.log("[wrapper] chat/stream authorized; proxying to runtime");
    return this.wrapperService.proxyChatStream(req, res, body);
  }

  @Post("notch/debug")
  @HttpCode(200)
  notchDebug(@Req() req: Request, @Body() body: NotchDebugRequestDto) {
    const text = String(body.text ?? "").trim();
    const files = Array.isArray(body.files) ? body.files : [];
    this.logger.log(
      `[wrapper] notch/debug incoming textChars=${text.length} fileCount=${files.length} createdAt=${String(
        body.createdAt ?? "",
      )} apiKeyChars=${String(req.headers["x-niki-api-key"] ?? "").trim().length}`,
    );
    if (text) {
      this.logger.log(`[wrapper] notch/debug text="${text.slice(0, 240)}"`);
    }
    if (files.length > 0) {
      this.logger.log(
        `[wrapper] notch/debug files=${JSON.stringify(
          files.map((file) => ({
            name: file.name ?? "",
            path: file.path ?? "",
            kind: file.kind ?? "",
          })),
        )}`,
      );
    }
    this.wrapperService.assertAuthorized(req);
    this.logger.log("[wrapper] notch/debug authorized");
    return this.wrapperService.enqueueNotchRequest(req, body);
  }

  @Post("notch/consume")
  @HttpCode(200)
  consumeNotch(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.consumeNotchRequest(req);
  }

  @Get("v1/me")
  me(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.me(req);
  }

  @Get("v1/activities")
  activities(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.activities(req);
  }

  @Get("v1/memory")
  listMemory(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.listMemory(req);
  }

  @Post("v1/memory")
  @HttpCode(200)
  setMemory(
    @Body() body: { key: string; value: string; ttl?: number },
    @Req() req: Request,
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.setMemory(body.key, body.value, body.ttl, req);
  }

  @Delete("v1/memory/:key")
  deleteMemory(@Param("key") key: string, @Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.deleteMemory(key, req);
  }

  @Get("v1/work-items")
  listWorkItems(
    @Req() req: Request,
    @Query() query: { kind?: string; status?: string; search?: string },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.listWorkItems(req, query);
  }

  @Post("v1/work-items")
  @HttpCode(200)
  createWorkItem(
    @Req() req: Request,
    @Body()
    body: {
      kind?: string;
      title?: string;
      notes?: string;
      category?: string;
      status?: string;
      priority?: string;
      dueAt?: string;
      subtasks?: Array<{ id?: string; title?: string; done?: boolean }>;
      proposalStatus?: string;
      sourceSessionId?: string;
      source?: string;
    },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.createWorkItem(req, body);
  }

  @Patch("v1/work-items/:id")
  @HttpCode(200)
  updateWorkItem(
    @Req() req: Request,
    @Param("id") id: string,
    @Body()
    body: {
      kind?: string;
      title?: string;
      notes?: string;
      category?: string;
      status?: string;
      priority?: string;
      dueAt?: string;
      subtasks?: Array<{ id?: string; title?: string; done?: boolean }>;
      proposalStatus?: string;
    },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.updateWorkItem(req, id, body);
  }

  @Delete("v1/work-items/:id")
  deleteWorkItem(@Req() req: Request, @Param("id") id: string) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.deleteWorkItem(req, id);
  }

  @Post("voice/transcribe")
  @HttpCode(200)
  @UseInterceptors(FileInterceptor("audio"))
  async transcribeVoice(
    @Req() req: Request,
    @UploadedFile()
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    } | undefined,
    @Body() body?: { audio?: string; language?: string; prompt?: string },
    @Query("language") queryLanguage?: string,
  ) {
    this.wrapperService.assertAuthorized(req);
    const language = queryLanguage || body?.language;
    let audioBuffer: Buffer | undefined;

    if (file && file.buffer && file.buffer.length > 0) {
      console.log("[voice/transcribe] multipart:", { size: file.size, mimetype: file.mimetype, originalname: file.originalname });
      audioBuffer = file.buffer;
    } else if (body?.audio) {
      console.log("[voice/transcribe] base64 length:", body.audio.length);
      try {
        audioBuffer = Buffer.from(body.audio, "base64");
        console.log("[voice/transcribe] base64 decoded:", audioBuffer.length, "bytes");
      } catch {
        return { ok: false, error: "Invalid base64 audio" };
      }
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      console.log("[voice/transcribe] no audio buffer");
      return { ok: false, error: "No audio file uploaded" };
    }

    const prompt = body?.prompt;

    if (!this.voiceService.isEnabled()) {
      return { ok: false, error: "Voice service not configured" };
    }
    try {
      const result = await this.voiceService.transcribe(audioBuffer, language, prompt);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  @Post("voice/synthesize")
  @HttpCode(200)
  async synthesizeVoice(
    @Req() req: Request,
    @Body() body: { text?: string; language?: string; voice?: string },
  ) {
    this.wrapperService.assertAuthorized(req);
    const text = String(body?.text ?? "").trim();
    const language = body?.language;
    const voice = body?.voice;

    if (!text) {
      return { ok: false, error: "No text provided" };
    }

    if (!this.voiceService.isTtsEnabled()) {
      return { ok: false, error: "TTS not configured" };
    }

    try {
      const result = await this.voiceService.synthesize(text, language, voice);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }
}
