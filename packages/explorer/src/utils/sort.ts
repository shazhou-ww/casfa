/**
 * Sorting utilities for explorer items.
 *
 * Directories are always sorted before files regardless of sort field.
 */

import type { ExplorerItem, SortDirection, SortField } from "../types.ts";

/**
 * Sort explorer items.
 *
 * @param items - Items to sort
 * @param field - Field to sort by (null = default: dirs first, then name asc)
 * @param direction - Sort direction
 * @returns New sorted array (does not mutate input)
 */
export function sortItems(
  items: ExplorerItem[],
  field: SortField | null,
  direction: SortDirection
): ExplorerItem[] {
  return [...items].sort((a, b) => {
    // Directories always come first
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }

    // Default sort: name ascending
    if (!field) {
      return a.name.localeCompare(b.name);
    }

    const dir = direction === "asc" ? 1 : -1;

    switch (field) {
      case "name":
        return a.name.localeCompare(b.name) * dir;
      case "size": {
        const aSize = a.size ?? 0;
        const bSize = b.size ?? 0;
        return (aSize - bSize) * dir;
      }
      case "type": {
        const aType = a.isDirectory ? "Folder" : (a.contentType ?? "File");
        const bType = b.isDirectory ? "Folder" : (b.contentType ?? "File");
        return aType.localeCompare(bType) * dir;
      }
      default:
        return 0;
    }
  });
}

/**
 * Cycle sort direction: null → asc → desc → null.
 * Clicking a new column always starts with asc.
 */
export function nextSortState(
  currentField: SortField | null,
  currentDirection: SortDirection,
  clickedField: SortField
): { field: SortField | null; direction: SortDirection } {
  if (currentField !== clickedField) {
    return { field: clickedField, direction: "asc" };
  }
  if (currentDirection === "asc") {
    return { field: clickedField, direction: "desc" };
  }
  // desc → reset to default
  return { field: null, direction: "asc" };
}
