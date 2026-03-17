import type { Message } from "./api.ts";

export function resolveStreamMessageCreatedAt(
  persistedMessages: Message[],
  startedAt: number,
  streamOrderOffset = 0
): number {
  const latestPersistedCreatedAt = persistedMessages.reduce(
    (max, msg) => (msg.createdAt > max ? msg.createdAt : max),
    0
  );
  const minAfterPersisted = latestPersistedCreatedAt + 1 + streamOrderOffset;
  return startedAt > minAfterPersisted ? startedAt : minAfterPersisted;
}
