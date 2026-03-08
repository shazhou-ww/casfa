import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LLMProvider } from "../../stores/agent-store.ts";

function defaultProvider(): LLMProvider {
  return {
    id: `provider_${Date.now()}`,
    name: "",
    baseUrl: "",
    apiKey: "",
    models: [],
  };
}

function defaultModel(): { id: string; name?: string } {
  return { id: `model_${Date.now()}`, name: "" };
}

type Props = {
  open: boolean;
  onClose: () => void;
  providers: LLMProvider[];
  onSave: (providers: LLMProvider[]) => Promise<void>;
};

export function LLMProvidersEditor({ open, onClose, providers, onSave }: Props) {
  const [list, setList] = useState<LLMProvider[]>(() =>
    providers.length ? providers.map((p) => ({ ...p, apiKey: "" })) : [defaultProvider()]
  );
  const [saving, setSaving] = useState(false);
  const initialProvidersRef = useRef(providers);
  if (open && initialProvidersRef.current !== providers) initialProvidersRef.current = providers;

  useEffect(() => {
    if (open) {
      setList(providers.length ? providers.map((p) => ({ ...p, apiKey: "" })) : [defaultProvider()]);
    }
  }, [open, providers]);

  const addProvider = useCallback(() => {
    setList((prev) => [...prev, defaultProvider()]);
  }, []);

  const removeProvider = useCallback((index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateProvider = useCallback((index: number, patch: Partial<LLMProvider>) => {
    setList((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }, []);

  const addModel = useCallback((providerIndex: number) => {
    setList((prev) =>
      prev.map((p, i) =>
        i === providerIndex ? { ...p, models: [...p.models, defaultModel()] } : p
      )
    );
  }, []);

  const removeModel = useCallback((providerIndex: number, modelIndex: number) => {
    setList((prev) =>
      prev.map((p, i) =>
        i === providerIndex ? { ...p, models: p.models.filter((_, j) => j !== modelIndex) } : p
      )
    );
  }, []);

  const updateModel = useCallback(
    (providerIndex: number, modelIndex: number, patch: { id?: string; name?: string }) => {
      setList((prev) =>
        prev.map((p, i) =>
          i === providerIndex
            ? {
                ...p,
                models: p.models.map((m, j) => (j === modelIndex ? { ...m, ...patch } : m)),
              }
            : p
        )
      );
    },
    []
  );

  const handleSave = useCallback(async () => {
    const initial = initialProvidersRef.current;
    const toSave = list
      .filter((p) => p.baseUrl.trim())
      .map((p) => {
        const prev = initial.find((i) => i.id === p.id);
        const apiKey = p.apiKey && p.apiKey.trim() ? p.apiKey : (prev?.apiKey ?? "");
        return { ...p, apiKey, models: p.models.filter((m) => m.id.trim()) };
      });
    if (!toSave.length) return;
    setSaving(true);
    try {
      await onSave(toSave);
      onClose();
    } finally {
      setSaving(false);
    }
  }, [list, onSave, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>LLM providers</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {list.map((provider, pi) => (
            <Box
              key={provider.id}
              sx={{
                p: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 1,
              }}
            >
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                <Typography variant="subtitle2">Provider {pi + 1}</Typography>
                <IconButton size="small" onClick={() => removeProvider(pi)} aria-label="Remove provider">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
              <TextField
                label="Name"
                size="small"
                fullWidth
                margin="dense"
                value={provider.name ?? ""}
                onChange={(e) => updateProvider(pi, { name: e.target.value })}
                placeholder="e.g. OpenAI"
              />
              <TextField
                label="Base URL"
                size="small"
                fullWidth
                margin="dense"
                required
                value={provider.baseUrl}
                onChange={(e) => updateProvider(pi, { baseUrl: e.target.value })}
                placeholder="https://api.openai.com"
              />
              <TextField
                label="API Key"
                type="password"
                size="small"
                fullWidth
                margin="dense"
                value={provider.apiKey}
                onChange={(e) => updateProvider(pi, { apiKey: e.target.value })}
                placeholder="Leave empty to keep existing"
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                Models
              </Typography>
              {provider.models.map((model, mi) => (
                <Box key={model.id} display="flex" gap={1} alignItems="center" mt={0.5}>
                  <TextField
                    size="small"
                    placeholder="Model ID"
                    value={model.id}
                    onChange={(e) => updateModel(pi, mi, { id: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    placeholder="Display name"
                    value={model.name ?? ""}
                    onChange={(e) => updateModel(pi, mi, { name: e.target.value })}
                    sx={{ flex: 1 }}
                  />
                  <IconButton size="small" onClick={() => removeModel(pi, mi)} aria-label="Remove model">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={() => addModel(pi)} sx={{ mt: 0.5 }}>
                Add model
              </Button>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={addProvider}>
            Add provider
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
