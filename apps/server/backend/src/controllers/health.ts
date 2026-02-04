/**
 * Health check controller
 */

import type { Context } from "hono";

export type HealthController = {
  check: (c: Context) => Response;
};

export const createHealthController = (): HealthController => ({
  check: (c) => c.json({ status: "ok", service: "casfa-v2" }),
});
