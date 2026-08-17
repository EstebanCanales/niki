import { actingUserIdFrom } from "../modules/common/request-context";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";

import { SpeakerService } from "../modules/voice/speaker.service";
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
    @Inject(SpeakerService) private readonly speakerService: SpeakerService,
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

  @Get("runtime/capabilities")
  runtimeCapabilities(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeCapabilities();
  }

  @Get("runtime/sessions")
  runtimeSessions(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeSessions();
  }

  @Get("runtime/profiles")
  runtimeProfiles(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeProfiles();
  }

  @Post("runtime/sessions/handoff")
  @HttpCode(200)
  runtimeSessionHandoff(
    @Req() req: Request,
    @Body() body: { sessionId?: string; platform?: string },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.requestSessionHandoff(body);
  }

  @Post("runtime/sessions/undo")
  @HttpCode(200)
  runtimeSessionUndo(
    @Req() req: Request,
    @Body() body: { sessionId?: string },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.requestSessionUndo(body);
  }

  @Get("runtime/mcp")
  runtimeMcp(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeMcpServers();
  }

  @Post("runtime/mcp/server")
  @HttpCode(200)
  runtimeMcpServerUpdate(
    @Req() req: Request,
    @Body() body: { id?: string; enabled?: boolean },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.updateRuntimeMcpServer(body);
  }

  @Get("runtime/discover")
  runtimeDiscover(@Req() req: Request, @Query("profileId") profileId?: string) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.runtimeDiscoverCapabilities(profileId);
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

  @Post("runtime/approvals/respond")
  @HttpCode(200)
  runtimeApprovalRespond(
    @Req() req: Request,
    @Body() body: { runId?: string; choice?: string; all?: boolean },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.respondToApproval(body);
  }

  /**
   * La app avisa que Esteban cortó a Niki a mitad de frase.
   *
   * Esa interrupción es la señal de calidad más honesta que hay —la respuesta era larga,
   * equivocada o fuera de tono— y hasta ahora se perdía del lado del cliente. No devuelve
   * nada útil ni bloquea: es telemetría del turno, no parte del turno.
   */
  @Post("runtime/turno/interrupcion")
  @HttpCode(200)
  runtimeTurnoInterrumpido(@Req() req: Request, @Body() body: { sessionId?: string; spoken?: string }) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.marcarInterrupcion(body);
  }

  /**
   * Qué se está guardando para entrenar. Son conversaciones reales de Esteban con su
   * máquina: tiene que poder verlas, apagar la captura y borrarlas sin abrir una terminal.
   */
  @Get("runtime/dataset")
  runtimeDataset(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.resumenDataset();
  }

  @Post("runtime/dataset/captura")
  @HttpCode(200)
  runtimeDatasetCaptura(@Req() req: Request, @Body() body: { enabled?: boolean }) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.configurarCaptura(body);
  }

  @Post("runtime/dataset/borrar")
  @HttpCode(200)
  runtimeDatasetBorrar(@Req() req: Request, @Body() body: { dia?: string; confirmar?: boolean }) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.borrarDataset(body);
  }

  /**
   * La terminal que comparten Esteban y Niki.
   *
   * No abre una terminal nueva: entra a la sesión que la IA ya usa, así que el `cd` de
   * uno lo ve el otro. Ver terminal-sesion.ts para cómo.
   */
  @Get("terminal")
  terminalEstado(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.estadoTerminal();
  }

  @Post("terminal/ejecutar")
  @HttpCode(200)
  terminalEjecutar(@Req() req: Request, @Body() body: { command?: string; confirmar?: boolean }) {
    // Mismo recaudo que computer/action: esto corre comandos en la máquina de Esteban, y
    // una página web cualquiera no puede ser quien los mande.
    this.wrapperService.assertTrustedOrigin(req);
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.ejecutarEnTerminal(body);
  }

  @Post("runtime/surface")
  @HttpCode(200)
  runtimeShowSurface(
    @Req() req: Request,
    @Body()
    body: {
      kind?: string;
      title?: string;
      subtitle?: string;
      query?: string;
      url?: string;
      location?: { label: string; lat?: number; lng?: number; address?: string };
      modelUrl?: string;
    },
  ) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.showSurface(body);
  }

  @Post("runtime/surface/clear")
  @HttpCode(200)
  runtimeClearSurface(@Req() req: Request) {
    this.wrapperService.assertAuthorized(req);
    return this.wrapperService.clearSurface();
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
    @Body() body?: { audio?: string; language?: string; prompt?: string; userId?: string },
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

    // Rechazar audio demasiado corto para tener habla real (< 0.5s a 16kHz 16bit mono)
    if (audioBuffer.length < 16_000) {
      return { ok: true, text: "", language: "es", duration: 0, provider: "skipped" };
    }

    const prompt = body?.prompt;

    if (!this.voiceService.isEnabled()) {
      return { ok: false, error: "Voice service not configured" };
    }
    try {
      // La huella corre EN PARALELO con la transcripción: Groq tarda ~1.1s, así que
      // saber quién habló no cuesta tiempo de reloj.
      const [result, speaker] = await Promise.all([
        this.voiceService.transcribe(audioBuffer, language, prompt),
        this.speakerService.verify(actingUserIdFrom(req), audioBuffer),
      ]);
      return { ...result, speaker };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /** Estado de la huella de voz: si hay perfil y con qué umbral. */
  @Get("voice/speaker")
  async speakerStatus(@Req() req: Request, @Query("userId") userId?: string) {
    this.wrapperService.assertAuthorized(req);
    if (!this.speakerService.available) return { ok: true, available: false, enrolled: false };
    const r = await this.speakerService.status(userId?.trim() || actingUserIdFrom(req));
    return { available: true, ...r };
  }

  /**
   * Registra la voz del dueño a partir de varias tomas. El umbral sale de cuánto varían
   * entre sí, no de una constante inventada.
   */
  @Post("voice/speaker/enroll")
  @HttpCode(200)
  async speakerEnroll(
    @Req() req: Request,
    @Body() body?: { userId?: string; samples?: string[] },
  ) {
    this.wrapperService.assertAuthorized(req);
    const samples = (body?.samples ?? []).map((s) => Buffer.from(s, "base64"));
    if (samples.length < 3) {
      return { ok: false, error: "Hacen falta al menos 3 tomas." };
    }
    return this.speakerService.enroll(body?.userId?.trim() || actingUserIdFrom(req), samples);
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
