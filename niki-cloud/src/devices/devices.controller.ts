import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

import { AuthenticatedRequest, SessionGuard } from "../auth/session.guard";
import { DeviceView, DevicesService, LinkedDeviceCredential } from "./devices.service";

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class LinkDeviceDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @Matches(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/)
  code!: string;

  @Transform(trimString)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  platform?: string;
}

@Controller("v1/devices")
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post("link-code")
  @UseGuards(SessionGuard)
  createLinkCode(@Req() request: AuthenticatedRequest): { code: string; expiresAt: Date } {
    return this.devices.createLinkCode(request.user!);
  }

  @Post("link")
  link(@Body() body: LinkDeviceDto): Promise<LinkedDeviceCredential> {
    return this.devices.link(body);
  }

  @Get()
  @UseGuards(SessionGuard)
  list(@Req() request: AuthenticatedRequest): Promise<DeviceView[]> {
    return this.devices.list(request.user!);
  }

  @Delete(":id")
  @UseGuards(SessionGuard)
  async revoke(
    @Req() request: AuthenticatedRequest,
    @Param("id", new ParseUUIDPipe()) deviceId: string,
  ): Promise<{ ok: true }> {
    await this.devices.revoke(request.user!, deviceId);
    return { ok: true };
  }
}
