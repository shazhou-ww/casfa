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

/** Thread: conversation container. */
export type Thread = {
  threadId: string;
  title?: string;
  modelId?: string;
  createdAt: number;
  updatedAt: number;
};

/** Content part (extensible: text now, image later). */
export type MessageContentPart = { type: "text"; text: string };

/** Message: single turn in a thread. */
export type Message = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: MessageContentPart[];
  createdAt: number;
};

/** Setting: key-value per realm, LWW per key. */
export type Setting = {
  key: string;
  value: unknown;
  updatedAt: number;
};
