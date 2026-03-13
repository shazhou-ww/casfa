import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve cell package root directory from project root by package name (e.g. @casfa/sso).
 * Walks rootDir and parent node_modules until the package is found; expects package root to contain cell.yaml.
 * Fallback: if spec has no "/" and no "@", tries rootDir/cells/<spec>, rootDir/apps/<spec>, and rootDir/../<spec>.
 * Fallback for package: if node_modules resolution fails, try rootDir/cells/<slug> where slug is the last segment of the package name (e.g. sso from @casfa/sso).
 */
export function resolveCellDir(rootDir: string, packageOrMount: string): string {
  const isPackageName = packageOrMount.includes("/") || packageOrMount.startsWith("@");
  if (isPackageName) {
    const dir = resolveCellDirByPackage(rootDir, packageOrMount);
    if (dir) return dir;
    const slug = packageOrMount.split("/").pop() ?? packageOrMount;
    const cellsSlug = resolve(rootDir, "cells", slug);
    if (existsSync(resolve(cellsSlug, "cell.yaml"))) return cellsSlug;
    const appsSlug = resolve(rootDir, "apps", slug);
    if (existsSync(resolve(appsSlug, "cell.yaml"))) return appsSlug;
  }
  const cellsSubdir = resolve(rootDir, "cells", packageOrMount);
  if (existsSync(resolve(cellsSubdir, "cell.yaml"))) {
    return cellsSubdir;
  }
  const appsSubdir = resolve(rootDir, "apps", packageOrMount);
  if (existsSync(resolve(appsSubdir, "cell.yaml"))) {
    return appsSubdir;
  }
  const sibling = resolve(rootDir, "..", packageOrMount);
  if (existsSync(resolve(sibling, "cell.yaml"))) {
    return sibling;
  }
  return isPackageName ? resolve(rootDir, "node_modules", packageOrMount) : cellsSubdir;
}

/**
 * Find package root (directory containing cell.yaml) by walking node_modules from rootDir upward.
 */
function resolveCellDirByPackage(rootDir: string, packageName: string): string | null {
  let dir = resolve(rootDir);
  const parts = packageName.split("/");
  const pkgPath = parts.length === 2 && packageName.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
  while (dir !== resolve(dir, "..")) {
    const candidate = resolve(dir, "node_modules", pkgPath);
    const cellYaml = resolve(candidate, "cell.yaml");
    if (existsSync(cellYaml)) {
      return candidate;
    }
    dir = resolve(dir, "..");
  }
  return null;
}
