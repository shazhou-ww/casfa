/**
 * <SearchBox /> - Toolbar search/filter input.
 * (Iter 3)
 */

import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import { useCallback, useEffect, useRef } from "react";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

export function SearchBox() {
  const t = useExplorerT();
  const searchTerm = useExplorerStore((s) => s.searchTerm);
  const setSearchTerm = useExplorerStore((s) => s.setSearchTerm);
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for Ctrl+F custom event from keyboard handler
  useEffect(() => {
    const handler = () => inputRef.current?.focus();
    document.addEventListener("explorer:focus-search", handler);
    return () => document.removeEventListener("explorer:focus-search", handler);
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchTerm(e.target.value);
    },
    [setSearchTerm]
  );

  const handleClear = useCallback(() => {
    setSearchTerm("");
    inputRef.current?.focus();
  }, [setSearchTerm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setSearchTerm("");
        inputRef.current?.blur();
      }
      // Prevent event from bubbling to container keyboard handler
      e.stopPropagation();
    },
    [setSearchTerm]
  );

  return (
    <TextField
      inputRef={inputRef}
      size="small"
      placeholder={t("search.placeholder")}
      value={searchTerm}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      sx={{ width: "100%" }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" color="action" />
            </InputAdornment>
          ),
          endAdornment: searchTerm ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={handleClear} edge="end">
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
          sx: { height: 32, fontSize: "0.875rem" },
        },
      }}
    />
  );
}
