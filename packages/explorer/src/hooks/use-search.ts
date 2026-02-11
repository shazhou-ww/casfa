/**
 * Search/filter hook for Iter 3.
 */

import { useMemo } from "react";
import { useExplorerStore } from "./use-explorer-context.ts";

/**
 * Returns the current search term and the filtered + sorted items.
 */
export function useSearch() {
  const searchTerm = useExplorerStore((s) => s.searchTerm);
  const setSearchTerm = useExplorerStore((s) => s.setSearchTerm);
  const getSortedItems = useExplorerStore((s) => s.getSortedItems);

  const items = getSortedItems();

  return {
    searchTerm,
    setSearchTerm,
    items,
  };
}

/**
 * Highlight matching text segments for search results.
 *
 * Returns an array of { text, highlight } segments.
 */
export function useHighlightMatch(
  text: string,
  searchTerm: string
): Array<{ text: string; highlight: boolean }> {
  return useMemo(() => {
    if (!searchTerm) return [{ text, highlight: false }];

    const lower = text.toLowerCase();
    const termLower = searchTerm.toLowerCase();
    const segments: Array<{ text: string; highlight: boolean }> = [];
    let lastIndex = 0;

    let index = lower.indexOf(termLower);
    while (index !== -1) {
      if (index > lastIndex) {
        segments.push({ text: text.slice(lastIndex, index), highlight: false });
      }
      segments.push({ text: text.slice(index, index + searchTerm.length), highlight: true });
      lastIndex = index + searchTerm.length;
      index = lower.indexOf(termLower, lastIndex);
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex), highlight: false });
    }

    return segments.length > 0 ? segments : [{ text, highlight: false }];
  }, [text, searchTerm]);
}
