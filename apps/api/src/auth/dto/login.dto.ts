import { LoginContext } from '@football-manager/database';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) => normalizeEmailInput(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsEnum(LoginContext)
  context?: LoginContext;
}

export type LoginResponseDto = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: {
    id: string;
    email: string;
    role: string;
    managerProfile: {
      displayName: string;
    } | null;
  };
};

function normalizeEmailInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().toLowerCase();
}
