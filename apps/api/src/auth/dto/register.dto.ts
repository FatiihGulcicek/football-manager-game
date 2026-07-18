import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { normalizeEmailInput } from '../utils/email-normalization';

export class RegisterDto {
  @Transform(({ value }) => normalizeEmailInput(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  password!: string;

  @Transform(({ value }) => trimStringInput(value))
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  displayName!: string;

  @Transform(({ value }) => trimStringInput(value))
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locale?: string;

  @Transform(({ value }) => trimStringInput(value))
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export type RegisterResponseDto = {
  status: 'accepted';
  message: string;
};

export const REGISTER_ACCEPTED_RESPONSE: RegisterResponseDto = {
  status: 'accepted',
  message:
    'Kayıt isteğiniz alındı. Uygunsa e-posta adresinize doğrulama bağlantısı gönderilecektir.'
};

function trimStringInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim();
}
