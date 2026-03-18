import { hashToKey } from "@casfa/core";
import type { CasFacade } from "@casfa/cas";
import { getNodeDecoded, resolvePath } from "./root-resolver.ts";

export type PatternMode = "glob" | "regex";

export type PathPatternMatch = {
  path: string;
  parentPath: string;
  name: string;
  nodeKey: string;
  captures: string[];
};

const GLOB_SPECIALS = /[*?[\]{}]/;

function normalizeRelativePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed) {
    throw new Error("E_PATH_INVALID: path must not be empty");
  }
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error("E_PATH_INVALID: path must not contain invalid segments");
    }
  }
  return segments.join("/");
}

function splitPatternPath(input: string): { parentPath: string; leafPattern: string } {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    throw new Error("E_INVALID_PATTERN: pattern must not be empty");
  }
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) {
    return { parentPath: "", leafPattern: normalized };
  }
  return {
    parentPath: normalized.slice(0, idx),
    leafPattern: normalized.slice(idx + 1),
  };
}

function braceExpandPattern(text: string): string {
  return text.replace(/\{([^{}]+)\}/g, (_all, inner: string) => {
    const options = inner
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&"));
    if (options.length === 0) return "";
    return `(${options.join("|")})`;
  });
}

function globLeafToRegExp(leafPattern: string): RegExp {
  const expanded = braceExpandPattern(leafPattern);
  let source = "";
  for (let i = 0; i < expanded.length; i += 1) {
    const ch = expanded[i]!;
    if (ch === "*") {
      source += "[^/]*";
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if (ch === "[") {
      const close = expanded.indexOf("]", i + 1);
      if (close > i + 1) {
        let inner = expanded.slice(i + 1, close);
        if (inner.startsWith("!")) inner = `^${inner.slice(1)}`;
        source += `[${inner}]`;
        i = close;
        continue;
      }
    }
    if ("\\^$+?.()|{}".includes(ch)) {
      source += `\\${ch}`;
      continue;
    }
    source += ch;
  }
  return new RegExp(`^${source}$`);
}

function buildLeafMatcher(
  mode: PatternMode,
  leafPattern: string
): (name: string) => { matched: boolean; captures: string[] } {
  if (mode === "glob") {
    const regex = globLeafToRegExp(leafPattern);
    return (name: string) => ({ matched: regex.test(name), captures: [] });
  }
  const regex = new RegExp(leafPattern);
  return (name: string) => {
    const result = regex.exec(name);
    return {
      matched: result !== null,
      captures: result ? result.slice(1) : [],
    };
  };
}

export function validatePatternMode(mode: PatternMode, pattern: string): void {
  if (mode !== "glob" && mode !== "regex") {
    throw new Error("E_INVALID_PATTERN: mode must be glob or regex");
  }
  const { parentPath, leafPattern } = splitPatternPath(pattern);
  if (!leafPattern) {
    throw new Error("E_INVALID_PATTERN: leaf pattern must not be empty");
  }
  if (mode === "glob") {
    if (pattern.includes("**")) {
      throw new Error("E_PATTERN_NOT_ALLOWED: recursive glob ** is not allowed");
    }
    if (GLOB_SPECIALS.test(parentPath)) {
      throw new Error("E_PATTERN_NOT_ALLOWED: wildcard is not allowed in parent path");
    }
    return;
  }
  if (leafPattern.includes("/")) {
    throw new Error("E_PATTERN_NOT_ALLOWED: regex must match basename only");
  }
}

export async function resolvePathPatternMatches(
  cas: CasFacade,
  rootKey: string,
  pattern: string,
  mode: PatternMode
): Promise<PathPatternMatch[]> {
  validatePatternMode(mode, pattern);
  const { parentPath, leafPattern } = splitPatternPath(pattern);
  const parentKey = parentPath ? await resolvePath(cas, rootKey, parentPath) : rootKey;
  if (!parentKey) return [];
  const parentNode = await getNodeDecoded(cas, parentKey);
  if (!parentNode || parentNode.kind !== "dict") return [];
  const matcher = buildLeafMatcher(mode, leafPattern);
  const childNames = parentNode.childNames ?? [];
  const children = parentNode.children ?? [];
  const results: PathPatternMatch[] = [];
  for (let i = 0; i < childNames.length; i += 1) {
    const name = childNames[i]!;
    const matched = matcher(name);
    if (!matched.matched) continue;
    const path = parentPath ? `${parentPath}/${name}` : name;
    results.push({
      path,
      parentPath,
      name,
      nodeKey: hashToKey(children[i]!),
      captures: matched.captures,
    });
  }
  return results;
}

export function applyPathTemplate(template: string, match: Omit<PathPatternMatch, "nodeKey">): string {
  const extIdx = match.name.lastIndexOf(".");
  const ext = extIdx > 0 ? match.name.slice(extIdx + 1) : "";
  const rendered = template.replace(/\{([^}]+)\}/g, (_all, token: string) => {
    if (token === "basename") return match.name;
    if (token === "dirname") return match.parentPath;
    if (token === "ext") return ext;
    if (token.startsWith("capture:")) {
      const index = Number.parseInt(token.slice("capture:".length), 10);
      if (!Number.isInteger(index) || index < 1) {
        throw new Error(`E_TEMPLATE_EVAL_FAILED: invalid capture index ${token}`);
      }
      const value = match.captures[index - 1];
      if (value === undefined) {
        throw new Error(`E_TEMPLATE_EVAL_FAILED: missing ${token}`);
      }
      return value;
    }
    throw new Error(`E_TEMPLATE_EVAL_FAILED: unknown token ${token}`);
  });
  return normalizeRelativePath(rendered);
}
