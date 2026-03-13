/** User auth from SSO JWT; realmId = userId for agent. */
export type UserAuth = {
  type: "user";
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
};

export type AuthContext = UserAuth;

export type Env = {
  Variables: {
    auth?: AuthContext;
  };
};

export type ErrorBody = {
  error: string;
  message: string;
  details?: unknown;
};

/** Thread: conversation container. title is required. */
export type Thread = {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

/** Content part: text, tool-call, or tool-result. */
export type TextContentPart = { type: "text"; text: string };
export type ToolCallContentPart = { type: "tool-call"; callId: string; name: string; arguments: string };
export type ToolResultContentPart = { type: "tool-result"; callId: string; result: string };
export type MessageContentPart = TextContentPart | ToolCallContentPart | ToolResultContentPart;

/** Message: single turn in a thread. modelId optional (e.g. for assistant). */
export type Message = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: MessageContentPart[];
  createdAt: number;
  modelId?: string;
};

/** Setting: key-value per realm, LWW per key. */
export type Setting = {
  key: string;
  value: unknown;
  updatedAt: number;
};
