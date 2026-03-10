/**
 * Shared helper: convert a slash-separated path string to PathSegment[]
 * for the @casfa/fs API.
 */
import type { PathSegment } from "@casfa/cas-uri";

export function pathToSegments(path: string | undefined): PathSegment[] {
  if (!path) return [];
  return path
    .split("/")
    .filter(Boolean)
    .map((value) => ({ kind: "name" as const, value }));
}
