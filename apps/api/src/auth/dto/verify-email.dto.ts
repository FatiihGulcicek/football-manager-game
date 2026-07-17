export type VerifyEmailDto = {
  token?: unknown;
};

export type VerifyEmailResponseDto = {
  status: 'verified';
  message: string;
};

export const EMAIL_VERIFIED_RESPONSE: VerifyEmailResponseDto = {
  status: 'verified',
  message: 'E-posta adresiniz doğrulandı.'
};
