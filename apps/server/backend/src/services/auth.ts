/**
 * Authentication service
 */

import { AuthenticationDetails, CognitoUser, CognitoUserPool } from "amazon-cognito-identity-js";
import type { CognitoConfig } from "../config.ts";
import type { TokensDb } from "../db/tokens.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Result } from "../util/result.ts";
import { err, ok } from "../util/result.ts";
import { extractTokenId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type LoginResult = {
  userToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
  role?: string;
};

export type RefreshResult = {
  userToken: string;
  expiresAt: string;
  role?: string;
};

export type AuthService = {
  login: (email: string, password: string) => Promise<Result<LoginResult>>;
  refresh: (refreshToken: string) => Promise<Result<RefreshResult>>;
};

type AuthServiceDeps = {
  tokensDb: TokensDb;
  userRolesDb: UserRolesDb;
  cognitoConfig: CognitoConfig;
};

// ============================================================================
// Factory
// ============================================================================

export const createAuthService = (deps: AuthServiceDeps): AuthService => {
  const { tokensDb, userRolesDb, cognitoConfig } = deps;

  const userPool = cognitoConfig.userPoolId
    ? new CognitoUserPool({
        UserPoolId: cognitoConfig.userPoolId,
        ClientId: cognitoConfig.clientId,
      })
    : null;

  const login = async (email: string, password: string): Promise<Result<LoginResult>> => {
    if (!userPool) {
      return err("Cognito not configured");
    }

    return new Promise((resolve) => {
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: userPool,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: async (session) => {
          const userId = session.getIdToken().payload.sub;
          const refreshToken = session.getRefreshToken().getToken();

          // Store token
          const token = await tokensDb.createUserToken(userId, refreshToken, 3600);
          const tokenId = extractTokenId(token.pk);

          // Get role
          const role = await userRolesDb.getRole(userId);

          resolve(
            ok({
              userToken: tokenId,
              refreshToken,
              expiresAt: new Date(token.expiresAt).toISOString(),
              user: {
                id: userId,
                email,
                name: session.getIdToken().payload.name,
              },
              role,
            })
          );
        },
        onFailure: (error) => {
          resolve(err(error.message ?? "Authentication failed"));
        },
      });
    });
  };

  const refresh = async (refreshToken: string): Promise<Result<RefreshResult>> => {
    if (!userPool) {
      return err("Cognito not configured");
    }

    // For now, just return an error - full implementation would use Cognito SDK
    // This is a simplified version
    return err("Refresh not implemented - use Cognito SDK directly");
  };

  return { login, refresh };
};
