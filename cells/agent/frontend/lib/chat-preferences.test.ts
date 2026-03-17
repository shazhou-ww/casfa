import { describe, expect, test } from "bun:test";
import {
  readDefaultModelId,
  readPromptLanguagePreference,
  writeDefaultModelId,
  writePromptLanguagePreference,
} from "./chat-preferences.ts";

type MemoryStorage = {
  data: Map<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function createMemoryStorage(): MemoryStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key) {
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

describe("chat preferences", () => {
  test("writes and reads default model id", () => {
    const storage = createMemoryStorage();
    expect(readDefaultModelId(storage)).toBeUndefined();
    writeDefaultModelId("gpt-4o-mini", storage);
    expect(readDefaultModelId(storage)).toBe("gpt-4o-mini");
  });

  test("writes and reads prompt language preference", () => {
    const storage = createMemoryStorage();
    expect(readPromptLanguagePreference(storage)).toBeUndefined();
    writePromptLanguagePreference("zh-CN", storage);
    expect(readPromptLanguagePreference(storage)).toBe("zh-CN");
  });

  test("ignores invalid prompt language value", () => {
    const storage = createMemoryStorage();
    storage.setItem("agent.defaultPromptLanguage", "fr");
    expect(readPromptLanguagePreference(storage)).toBeUndefined();
  });
});
