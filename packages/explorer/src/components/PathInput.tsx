/**
 * <PathInput /> - Editable path input with autocomplete.
 * (Iter 3)
 *
 * Toggled from Breadcrumb view: double-click breadcrumb or click edit icon.
 * Enter key navigates, Escape cancels.
 */

import { Autocomplete, TextField } from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type PathInputProps = {
  /** Called when user cancels editing (Escape or blur) */
  onCancel: () => void;
  /** Called after successful navigation */
  onNavigate?: (path: string) => void;
};

export function PathInput({ onCancel, onNavigate }: PathInputProps) {
  const t = useExplorerT();
  const currentPath = useExplorerStore((s) => s.currentPath);
  const navigate = useExplorerStore((s) => s.navigate);
  const localFs = useExplorerStore((s) => s.localFs);
  const depotRoot = useExplorerStore((s) => s.depotRoot);

  const [inputValue, setInputValue] = useState(currentPath);
  const [options, setOptions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Autocomplete: load directory children on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!depotRoot) return;

      // Determine parent path for autocomplete
      const lastSlash = inputValue.lastIndexOf("/");
      const parentPath = lastSlash >= 0 ? inputValue.substring(0, lastSlash) : "";
      const prefix =
        lastSlash >= 0
          ? inputValue.substring(lastSlash + 1).toLowerCase()
          : inputValue.toLowerCase();

      try {
        const result = await localFs.ls(depotRoot, parentPath || undefined, undefined, 50);
        if ("children" in result) {
          const suggestions = result.children
            .filter((c) => c.type === "dir")
            .map((c) => (parentPath ? `${parentPath}/${c.name}` : c.name))
            .filter((p) => !prefix || p.toLowerCase().includes(inputValue.toLowerCase()));
          setOptions(suggestions);
        }
      } catch {
        // Ignore autocomplete errors
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, depotRoot, localFs]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const path = inputValue.trim();

    // Validate: try to ls the path
    if (!depotRoot) return;
    try {
      const result = await localFs.ls(depotRoot, path || undefined, undefined, 1);
      if ("code" in result) {
        setError(t("pathInput.invalid"));
        return;
      }
      await navigate(path);
      onNavigate?.(path);
      onCancel();
    } catch {
      setError(t("pathInput.invalid"));
    }
  }, [inputValue, depotRoot, localFs, navigate, onNavigate, onCancel, t]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel]
  );

  return (
    <Autocomplete
      freeSolo
      options={options}
      inputValue={inputValue}
      onInputChange={(_e, value) => setInputValue(value)}
      onChange={(_e, value) => {
        if (typeof value === "string") {
          setInputValue(value);
        }
      }}
      size="small"
      sx={{ flex: 1 }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          placeholder={t("pathInput.placeholder")}
          error={!!error}
          helperText={error}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          slotProps={{
            input: {
              ...params.InputProps,
              sx: { height: 32, fontSize: "0.875rem" },
            },
            formHelperText: {
              sx: { position: "absolute", bottom: -18 },
            },
          }}
        />
      )}
    />
  );
}
