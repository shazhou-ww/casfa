/**
 * Admin API schemas
 */

import { z } from "zod";
import { UserRoleSchema } from "./common.ts";

/**
 * Schema for PATCH /api/admin/users/:userId
 * Update user role (authorize, promote to admin, or revoke access)
 */
export const UpdateUserRoleSchema = z.object({
  role: UserRoleSchema,
});

export type UpdateUserRole = z.infer<typeof UpdateUserRoleSchema>;
