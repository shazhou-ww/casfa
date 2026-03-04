import * as jose from "jose";
import type { JwtVerifier, VerifiedUser } from "./types.ts";

export function createCognitoJwtVerifier(config: {
  region: string;
  userPoolId: string;
}): JwtVerifier {
  const { region, userPoolId } = config;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jose.jwtVerify(token, jwks, { issuer });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in JWT");
    if (typeof payload.email !== "string") throw new Error("Missing email in JWT");
    if (typeof payload.name !== "string") throw new Error("Missing name in JWT");
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      rawClaims: payload as Record<string, unknown>,
    };
  };
}

export function createMockJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") throw new Error("Missing sub in mock JWT");
    if (typeof payload.email !== "string") throw new Error("Missing email in mock JWT");
    if (typeof payload.name !== "string") throw new Error("Missing name in mock JWT");
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      rawClaims: payload as Record<string, unknown>,
    };
  };
}

export async function createMockJwt(
  secret: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(key);
}
