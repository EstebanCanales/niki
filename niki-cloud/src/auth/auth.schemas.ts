import { Transform } from "class-transformer";
import { IsEmail, IsString, Matches } from "class-validator";

const normalizeEmailValue = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class WaitlistRequestDto {
  @Transform(normalizeEmailValue)
  @IsEmail()
  email!: string;
}

export class RequestMagicCodeDto {
  @Transform(normalizeEmailValue)
  @IsEmail()
  email!: string;
}

export class VerifyMagicCodeDto {
  @Transform(normalizeEmailValue)
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
