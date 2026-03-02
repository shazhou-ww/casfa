import * as jose from "jose";

export type CognitoJwtVerifierConfig = {
  region: string;
  userPoolId: string;
  clientId?: string;
};

export type CognitoJwtPayload = {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
};

const COGNITO_ISS_PREFIX = "https://cognito-idp.";

/**
 * Returns a verifier that fetches Cognito JWKS and validates JWT (iss, exp, optional aud),
 * then returns { sub, email?, name?, picture? }.
 */
export function createCognitoJwtVerifier(config: CognitoJwtVerifierConfig): (token: string) => Promise<CognitoJwtPayload> {
  const { region, userPoolId, clientId } = config;
  const jwksUrl = `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`;
  const issuer = `${COGNITO_ISS_PREFIX}${region}.amazonaws.com/${userPoolId}`;

  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  return async function verify(token: string): Promise<CognitoJwtPayload> {
    const trimmed = token?.trim();
    if (!trimmed) {
      throw new Error("Missing or empty token");
    }

    const options: jose.JWTVerifyOptions = {
      issuer,
      clockTolerance: 10,
    };
    if (clientId) {
      options.audience = clientId;
    }

    const { payload } = await jose.jwtVerify(trimmed, jwks, options);

    const sub = payload.sub;
    if (!sub || typeof sub !== "string") {
      throw new Error("Missing sub in token");
    }

    return {
      sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
    };
  };
}
