import type { SystemPromptLanguage } from "./prompt-settings.ts";

export const DEFAULT_MODEL_ID_KEY = "agent.defaultModelId";
export const DEFAULT_PROMPT_LANGUAGE_KEY = "agent.defaultPromptLanguage";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  return window.localStorage ?? null;
}

export function readDefaultModelId(storage: StorageLike | null = getBrowserStorage()): string | undefined {
  if (!storage) return undefined;
  const value = storage.getItem(DEFAULT_MODEL_ID_KEY);
  if (!value) return undefined;
  return value;
}

export function writeDefaultModelId(modelId: string, storage: StorageLike | null = getBrowserStorage()): void {
  if (!storage) return;
  storage.setItem(DEFAULT_MODEL_ID_KEY, modelId);
}

export function readPromptLanguagePreference(
  storage: StorageLike | null = getBrowserStorage()
): SystemPromptLanguage | undefined {
  if (!storage) return undefined;
  const value = storage.getItem(DEFAULT_PROMPT_LANGUAGE_KEY);
  if (value === "en" || value === "zh-CN") return value;
  return undefined;
}

export function writePromptLanguagePreference(
  language: SystemPromptLanguage,
  storage: StorageLike | null = getBrowserStorage()
): void {
  if (!storage) return;
  storage.setItem(DEFAULT_PROMPT_LANGUAGE_KEY, language);
}
