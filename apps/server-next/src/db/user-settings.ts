/** 用户设置白名单字段（首版） */
export type UserSettings = {
  language?: string;
  notifications?: boolean;
};

const SETTINGS_KEYS: (keyof UserSettings)[] = ["language", "notifications"];

function pickSettings(obj: Record<string, unknown>): UserSettings {
  const out: UserSettings = {};
  for (const k of SETTINGS_KEYS) {
    const v = obj[k];
    if (k === "language" && typeof v === "string") out.language = v;
    if (k === "notifications" && typeof v === "boolean") out.notifications = v;
  }
  return out;
}

export type UserSettingsStore = {
  get(userId: string): Promise<UserSettings>;
  set(userId: string, settings: Partial<UserSettings>): Promise<void>;
};

export function createMemoryUserSettingsStore(): UserSettingsStore {
  const map = new Map<string, UserSettings>();

  return {
    async get(userId: string): Promise<UserSettings> {
      const existing = map.get(userId);
      return existing ? { ...existing } : {};
    },

    async set(userId: string, settings: Partial<UserSettings>): Promise<void> {
      const filtered = pickSettings(settings as Record<string, unknown>);
      const current = map.get(userId) ?? {};
      map.set(userId, { ...current, ...filtered });
    },
  };
}
