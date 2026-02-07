import { http } from "./http";
import type { AuthResponse, RefreshResponse, UserInfo } from "./types";

export const authApi = {
  register: (email: string, password: string, name: string) =>
    http.post<AuthResponse>("/api/local/register", { email, password, name }),

  login: (email: string, password: string) =>
    http.post<AuthResponse>("/api/local/login", { email, password }),

  refresh: (refreshToken: string) =>
    http.post<RefreshResponse>("/api/local/refresh", { refreshToken }),

  me: (token?: string) => http.get<UserInfo>("/api/oauth/me", token ? { token } : undefined),
};
