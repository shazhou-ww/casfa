/**
 * Shared types for Agent ModelState, Actions, and Changes.
 * Used by both the main app and the Service Worker. See docs/plans/2026-03-08-agent-sw-model-state-design.md.
 */

// ----- Content & Message -----

export type TextContent = { type: "text"; text: string };

export type ToolCallContent = {
  type: "tool-call";
  callId: string;
  name: string;
  arguments: string;
};

export type ToolResultContent = {
  type: "tool-result";
  callId: string;
  result: string;
};

export type MessageContent = TextContent | ToolCallContent | ToolResultContent;

export type Message = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: MessageContent[];
  createdAt: number;
  modelId?: string;
};

// ----- Thread -----

export type Thread = {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

// ----- Stream -----

export type StreamStatus = "waiting_agent" | "streaming" | "done" | "error";

export type TextChunk = { type: "text"; text: string };

export type ToolCallChunk = {
  type: "tool-call";
  index?: number;
  callId?: string;
  name?: string;
  arguments?: string;
};

export type ToolResultChunk = {
  type: "tool-result";
  callId?: string;
  result?: string;
};

export type StreamChunk = TextChunk | ToolCallChunk | ToolResultChunk;

export type StreamState = {
  messageId: string;
  threadId: string;
  status: StreamStatus;
  chunks: StreamChunk[];
  error?: string;
  startedAt: number;
};

// ----- ModelState -----

export type ModelState = {
  threads: Thread[];
  messagesByThread: Record<string, Message[]>;
  streamByMessageId: Record<string, StreamState>;
  settings: Record<string, unknown>;
};

// ----- Action (UI → SW) -----

export type Action =
  | { kind: "threads.create"; payload: { title: string } }
  | { kind: "threads.delete"; payload: { threadId: string } }
  | { kind: "messages.send"; payload: { threadId: string; content: MessageContent[]; modelId?: string } }
  | { kind: "stream.cancel"; payload: { messageId: string } }
  | { kind: "settings.update"; payload: { key: string; value: unknown } }
  | { kind: "sync.pull"; payload?: { scope?: "threads" | "messages" | "settings"; threadId?: string } };

// ----- Change (SW → UI) -----

export type ChangeMessagesAppend = {
  kind: "messages.append";
  payload: { threadId: string; message: Message };
};

export type ChangeMessagesPatch = {
  kind: "messages.patch";
  payload: {
    threadId: string;
    messageId: string;
    patch: Partial<Pick<Message, "content" | "modelId">>;
  };
};

export type ChangeMessagesRemove = {
  kind: "messages.remove";
  payload: { threadId: string; messageId: string };
};

export type ChangeMessagesReplaced = {
  kind: "messages.replaced";
  payload: { threadId: string; messages: Message[] };
};

export type Change =
  | { kind: "threads.updated"; payload: { threads: Thread[] } }
  | ChangeMessagesAppend
  | ChangeMessagesPatch
  | ChangeMessagesRemove
  | ChangeMessagesReplaced
  | {
      kind: "stream.status";
      payload: {
        messageId: string;
        threadId: string;
        status: StreamStatus;
        error?: string;
      };
    }
  | {
      kind: "stream.chunk";
      payload: { messageId: string; threadId: string; chunk: StreamChunk };
    }
  | {
      kind: "stream.reset";
      payload: { messageId: string; threadId: string; status?: StreamStatus };
    }
  | {
      kind: "stream.done";
      payload: { messageId: string; threadId: string; message: Message };
    }
  | {
      kind: "stream.error";
      payload: { messageId: string; threadId: string; error: string };
    }
  | { kind: "settings.updated"; payload: { key: string; value?: unknown } }
  | {
      kind: "response";
      payload: {
        id: string;
        result?: unknown;
        error?: { code: string; message: string };
      };
    };

// ----- Wire format -----

export type OutgoingMessage = {
  type: "action";
  id?: string;
  action: Action;
  csrfToken?: string;
};

export type IncomingMessage = {
  type: "change";
  changes: Change[];
};
