import * as jose from "jose";
import type { JwtVerifier, VerifiedUser } from "./types.ts";

export function mapJwtPayloadToVerifiedUser(payload: jose.JWTPayload): VerifiedUser {
  if (typeof payload.sub !== "string") throw new Error("Missing sub in JWT");
  const userId = payload.sub;
  const email =
    typeof payload.email === "string"
      ? payload.email
      : typeof payload["cognito:username"] === "string"
        ? payload["cognito:username"]
        : userId;
  const name = typeof payload.name === "string" ? payload.name : email;
  return {
    userId,
    email,
    name,
    rawClaims: payload as Record<string, unknown>,
  };
}

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
    return mapJwtPayloadToVerifiedUser(payload);
  };
}

export function createMockJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);
  return async (token: string): Promise<VerifiedUser> => {
    const { payload } = await jose.jwtVerify(token, key, { algorithms: ["HS256"] });
    return mapJwtPayloadToVerifiedUser(payload);
  };
}

export async function createMockJwt(
  secret: string,
  payload: Record<string, unknown>
): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new jose.SignJWT(payload as jose.JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(key);
}
