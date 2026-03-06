export type UserAuth = {
  type: "user";
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
};

/** Compatible with cell-cognito-server verifiers (they return VerifiedUser or throw). Callers may pass a function that throws on invalid token; we treat that as null. */
export type JwtVerifier = (
  token: string
) => Promise<{ userId: string; email?: string; name?: string; rawClaims?: Record<string, unknown> } | null>;

export async function verifyUserToken(
  bearerToken: string,
  jwtVerifier: JwtVerifier
): Promise<UserAuth | null> {
  let result: { userId: string; email?: string; name?: string; rawClaims?: Record<string, unknown> } | null;
  try {
    result = await jwtVerifier(bearerToken);
  } catch {
    return null;
  }
  if (result == null) {
    return null;
  }
  return {
    type: "user",
    userId: result.userId,
    email: result.email,
    name: result.name,
    picture:
      typeof result.rawClaims?.picture === "string" ? result.rawClaims.picture : undefined,
  };
}
