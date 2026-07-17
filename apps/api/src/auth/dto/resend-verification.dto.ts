import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsString, MaxLength } from 'class-validator';
import { normalizeEmailInput } from '../utils/email-normalization';

export class ResendVerificationDto {
  @Transform(({ value }) => normalizeEmailInput(value))
  @IsDefined()
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export type ResendVerificationResponseDto = {
  status: 'accepted';
  message: string;
};

export const RESEND_VERIFICATION_ACCEPTED_RESPONSE: ResendVerificationResponseDto = {
  status: 'accepted',
  message: 'E-posta adresi uygunsa yeni doğrulama bağlantısı gönderilecektir.'
};
