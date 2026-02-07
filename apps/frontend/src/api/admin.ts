import { http } from "./http";

export type AdminUserInfo = {
  userId: string;
  role: string;
};

export const adminApi = {
  listUsers: () => http.get<{ users: AdminUserInfo[] }>("/api/admin/users"),

  updateRole: (userId: string, role: string) =>
    http.patch<void>(`/api/admin/users/${userId}`, { role }),
};
