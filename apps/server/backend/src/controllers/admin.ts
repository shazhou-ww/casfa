/**
 * Admin controller
 */

import { UpdateUserRoleSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { CognitoConfig } from "../config.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Env } from "../types.ts";

export type AdminController = {
  listUsers: (c: Context<Env>) => Promise<Response>;
  updateRole: (c: Context<Env>) => Promise<Response>;
};

type AdminControllerDeps = {
  userRolesDb: UserRolesDb;
  cognitoConfig: CognitoConfig;
};

// Note: For production, you'd want to implement getCognitoUserMap
// to fetch user details from Cognito. For now, we just return basic info.
export const createAdminController = (deps: AdminControllerDeps): AdminController => {
  const { userRolesDb } = deps;

  return {
    listUsers: async (c) => {
      const list = await userRolesDb.listRoles();

      const users = list.map((u) => ({
        userId: u.userId,
        role: u.role,
        email: "", // Would be fetched from Cognito
        name: undefined,
      }));

      return c.json({ users });
    },

    updateRole: async (c) => {
      const targetUserId = decodeURIComponent(c.req.param("userId"));
      const { role } = UpdateUserRoleSchema.parse(await c.req.json());

      await userRolesDb.setRole(targetUserId, role);

      return c.json({ userId: targetUserId, role });
    },
  };
};
