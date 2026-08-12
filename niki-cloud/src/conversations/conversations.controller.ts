import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";

import { AuthenticatedRequest, SessionGuard } from "../auth/session.guard";
import { DeviceSignatureService } from "../metering/device-signature.service";
import {
  ConversationsService,
  DeviceConversationBatch,
  DeviceConversationMessage,
} from "./conversations.service";

interface RawDeviceRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

const singleHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? undefined : value;

export class ConversationMessageDto implements DeviceConversationMessage {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  messageId!: string;

  @IsIn(["user", "assistant", "system", "tool"])
  role!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;
}

export class DeviceConversationBatchDto implements DeviceConversationBatch {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  previousCursor!: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  cursor!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  conversationId!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title?: string;

  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ConversationMessageDto)
  messages!: ConversationMessageDto[];
}

export class ConversationSyncSettingDto {
  @IsBoolean()
  enabled!: boolean;
}

@Controller("v1")
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly signatures: DeviceSignatureService,
  ) {}

  @Get("conversations")
  @UseGuards(SessionGuard)
  list(@Req() request: AuthenticatedRequest) {
    return this.conversations.listConversations(request.user!.id);
  }

  @Get("conversations/:id")
  @UseGuards(SessionGuard)
  get(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    return this.conversations.getConversation(request.user!.id, id);
  }

  @Patch("settings/conversation-sync")
  @UseGuards(SessionGuard)
  setSync(@Req() request: AuthenticatedRequest, @Body() body: ConversationSyncSettingDto) {
    return this.conversations.setConversationSync(request.user!.id, body.enabled);
  }

  @Post("device-conversations/batch")
  async ingest(
    @Req() request: RawDeviceRequest,
    @Body() body: DeviceConversationBatchDto,
  ) {
    if (!request.rawBody) {
      throw new UnauthorizedException("Raw request body is required for device signatures");
    }
    const device = await this.signatures.verify(
      {
        deviceId: singleHeader(request.headers["x-niki-device-id"]),
        timestamp: singleHeader(request.headers["x-niki-timestamp"]),
        signature: singleHeader(request.headers["x-niki-signature"]),
      },
      request.rawBody,
    );
    return this.conversations.ingestBatch(device, body);
  }
}
