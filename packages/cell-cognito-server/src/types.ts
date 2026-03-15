export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  clientSecret?: string;
  hostedUiUrl: string;
};

export type CognitoTokenSet = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type CognitoRefreshedTokenSet = {
  idToken: string;
  accessToken: string;
  expiresAt: number;
};

export type VerifiedUser = {
  userId: string;
  email: string;
  name: string;
  rawClaims: Record<string, unknown>;
};

export type JwtVerifier = (token: string) => Promise<VerifiedUser>;
