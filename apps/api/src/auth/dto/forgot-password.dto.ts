import { Transform } from 'class-transformer';
import { IsDefined, IsEmail, IsString, MaxLength } from 'class-validator';
import { normalizeEmailInput } from '../utils/email-normalization';

export class ForgotPasswordDto {
  @Transform(({ value }) => normalizeEmailInput(value))
  @IsDefined()
  @IsString()
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export type ForgotPasswordResponseDto = {
  status: 'accepted';
  message: string;
};

export const FORGOT_PASSWORD_ACCEPTED_RESPONSE: ForgotPasswordResponseDto = {
  status: 'accepted',
  message: 'E-posta adresi uygunsa parola s\u0131f\u0131rlama ba\u011flant\u0131s\u0131 g\u00f6nderilecektir.'
};
