import { Type } from "class-transformer";
import {
  ArrayNotEmpty,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export const USAGE_CATEGORIES = [
  "chat.input_tokens",
  "chat.output_tokens",
  "voice.stt_seconds",
  "voice.tts_seconds",
  "tool.call",
] as const;

export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

export interface DeviceUsageEvent {
  eventId: string;
  occurredAt: string;
  category: UsageCategory;
  quantity: number;
  model?: string;
  conversationId?: string;
  metadata?: Record<string, string>;
}

export interface DeviceUsageBatch {
  events: DeviceUsageEvent[];
}

export class DeviceUsageEventDto implements DeviceUsageEvent {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  eventId!: string;

  @IsISO8601({ strict: true })
  occurredAt!: string;

  @IsIn(USAGE_CATEGORIES)
  category!: UsageCategory;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  conversationId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, string>;
}

export class DeviceUsageBatchDto implements DeviceUsageBatch {
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => DeviceUsageEventDto)
  events!: DeviceUsageEventDto[];
}
