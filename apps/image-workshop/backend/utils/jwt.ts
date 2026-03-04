import * as jose from "jose";

export type JwtPayload = {
  sub: string;
  email?: string;
  name?: string;
};

export type JwtVerifier = (token: string) => Promise<JwtPayload>;

export function createCognitoJwtVerifier(config: {
  region: string;
  userPoolId: string;
  clientId: string;
}): JwtVerifier {
  const { region, userPoolId } = config;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jose.jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in JWT");
    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    };
  };
}

export function createMockJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token: string): Promise<JwtPayload> => {
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in mock JWT");
    return {
      sub: payload.sub,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
    };
  };
}
