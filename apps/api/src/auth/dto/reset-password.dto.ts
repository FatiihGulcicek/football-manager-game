import { IsDefined, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsDefined()
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  token!: string;

  @IsDefined()
  @IsString()
  newPassword!: string;
}

export type ResetPasswordResponseDto = {
  status: 'success';
  message: string;
};

export const RESET_PASSWORD_SUCCESS_RESPONSE: ResetPasswordResponseDto = {
  status: 'success',
  message: 'Parolan\u0131z ba\u015far\u0131yla g\u00fcncellendi. L\u00fctfen yeniden giri\u015f yap\u0131n.'
};
