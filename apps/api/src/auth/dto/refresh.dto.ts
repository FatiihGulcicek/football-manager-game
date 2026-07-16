export type RefreshResponseDto = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
};
