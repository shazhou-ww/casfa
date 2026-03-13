export const SYSTEM_PROMPT_LANGUAGE_KEY = "agent.systemPromptLanguage";

export type SystemPromptLanguage = "en" | "zh-CN";

export function parseSystemPromptLanguage(value: unknown): SystemPromptLanguage {
  return value === "zh-CN" ? "zh-CN" : "en";
}
