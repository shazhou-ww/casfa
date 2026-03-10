import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface ProfileConfig {
  baseUrl: string;
  realm?: string;
}

export interface CacheConfig {
  enabled: boolean;
  maxSize: string;
  path: string;
}

export interface Config {
  currentProfile: string;
  profiles: Record<string, ProfileConfig>;
  cache: CacheConfig;
}

const DEFAULT_CONFIG: Config = {
  currentProfile: "default",
  profiles: {
    default: {
      baseUrl: "http://localhost:8801",
    },
  },
  cache: {
    enabled: true,
    maxSize: "500MB",
    path: "~/.casfa/cache",
  },
};

export function getCasfaDir(): string {
  return path.join(os.homedir(), ".casfa");
}

export function getConfigPath(): string {
  return path.join(getCasfaDir(), "config.json");
}

export function ensureCasfaDir(): void {
  const dir = getCasfaDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function loadConfig(): Config {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const loaded = JSON.parse(content) as Partial<Config>;
    return {
      ...DEFAULT_CONFIG,
      ...loaded,
      cache: { ...DEFAULT_CONFIG.cache, ...loaded.cache },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  ensureCasfaDir();
  const configPath = getConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

export function getProfile(config: Config, profileName?: string): ProfileConfig {
  const name = profileName || config.currentProfile;
  const profile = config.profiles[name];
  if (!profile) {
    throw new Error(`Profile "${name}" not found. Run 'casfa config init' to create one.`);
  }
  return profile;
}

export function setConfigValue(config: Config, key: string, value: string): void {
  const parts = key.split(".");

  if (parts[0] === "cache") {
    if (parts[1] === "enabled") {
      config.cache.enabled = value === "true";
    } else if (parts[1] === "maxSize") {
      config.cache.maxSize = value;
    } else if (parts[1] === "path") {
      config.cache.path = value;
    } else {
      throw new Error(`Unknown cache config key: ${key}`);
    }
  } else if (parts[0] === "currentProfile") {
    if (!config.profiles[value]) {
      throw new Error(`Profile "${value}" does not exist`);
    }
    config.currentProfile = value;
  } else {
    // Assume it's a profile config: baseUrl, realm
    const profile = config.profiles[config.currentProfile];
    if (!profile) {
      throw new Error(`Current profile not found`);
    }
    if (parts[0] === "baseUrl") {
      profile.baseUrl = value;
    } else if (parts[0] === "realm") {
      profile.realm = value;
    } else {
      throw new Error(`Unknown config key: ${key}`);
    }
  }
}

export function getConfigValue(config: Config, key: string): string | undefined {
  const parts = key.split(".");

  if (parts[0] === "cache") {
    if (parts[1] === "enabled") return String(config.cache.enabled);
    if (parts[1] === "maxSize") return config.cache.maxSize;
    if (parts[1] === "path") return config.cache.path;
  } else if (parts[0] === "currentProfile") {
    return config.currentProfile;
  } else {
    const profile = config.profiles[config.currentProfile];
    if (parts[0] === "baseUrl") return profile?.baseUrl;
    if (parts[0] === "realm") return profile?.realm;
  }
  return undefined;
}

export function listProfiles(
  config: Config
): Array<{ name: string; current: boolean; baseUrl: string }> {
  return Object.entries(config.profiles).map(([name, profile]) => ({
    name,
    current: name === config.currentProfile,
    baseUrl: profile.baseUrl,
  }));
}

export function createProfile(config: Config, name: string, baseUrl: string): void {
  if (config.profiles[name]) {
    throw new Error(`Profile "${name}" already exists`);
  }
  config.profiles[name] = { baseUrl };
}

export function deleteProfile(config: Config, name: string): void {
  if (!config.profiles[name]) {
    throw new Error(`Profile "${name}" does not exist`);
  }
  if (name === config.currentProfile) {
    throw new Error(`Cannot delete current profile. Switch to another profile first.`);
  }
  delete config.profiles[name];
}

export function resolvePath(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}
