import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { Box, IconButton, List, ListItem, ListItemButton, Typography } from "@mui/material";
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentStore } from "../../stores/agent-store.ts";

export function ThreadList() {
  const navigate = useNavigate();
  const threads = useAgentStore((s) => s.threads);
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const setCurrentThreadId = useAgentStore((s) => s.setCurrentThreadId);
  const createThread = useAgentStore((s) => s.createThread);
  const deleteThread = useAgentStore((s) => s.deleteThread);
  const threadsLoading = useAgentStore((s) => s.threadsLoading);
  const swReady = useAgentStore((s) => s.swPort != null);

  const handleNewThread = useCallback(async () => {
    await createThread({ title: "New chat" });
    navigate("/", { replace: false });
  }, [createThread, navigate]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      await deleteThread(threadId);
    },
    [deleteThread]
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider", display: "flex", alignItems: "center", gap: 0.5 }}>
        <IconButton size="small" onClick={handleNewThread} aria-label="New thread" disabled={!swReady}>
          <AddIcon />
        </IconButton>
        <Typography variant="subtitle2" color="text.secondary">
          Threads
        </Typography>
      </Box>
      <List dense disablePadding sx={{ flex: 1, overflow: "auto" }}>
        {threadsLoading && threads.length === 0 ? (
          <ListItemButton disabled>
            <Typography variant="body2" color="text.secondary">
              Loading…
            </Typography>
          </ListItemButton>
        ) : (
          threads.map((t) => (
            <ListItem
              key={t.threadId}
              disablePadding
              secondaryAction={
                <IconButton
                  size="small"
                  edge="end"
                  onClick={(e) => handleDelete(e, t.threadId)}
                  aria-label="Delete thread"
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemButton
                selected={t.threadId === currentThreadId}
                onClick={() => setCurrentThreadId(t.threadId)}
                sx={{ py: 0.75 }}
              >
                <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                  {t.title || "Untitled"}
                </Typography>
              </ListItemButton>
            </ListItem>
          ))
        )}
      </List>
    </Box>
  );
}
