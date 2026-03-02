/**
 * Explorer path <-> frontend route mapping.
 * - Path "/" -> route "/files"
 * - Path "/Documents" -> route "/files/Documents"
 */

export function pathToRoute(path: string): string {
  const p = (path || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  if (p === "/") return "/files";
  return "/files" + p;
}

export function routeToPath(pathname: string): string {
  if (!pathname || pathname === "/" || pathname === "/files" || pathname === "/files/") {
    return "/";
  }
  if (pathname.startsWith("/files/")) {
    return "/" + pathname.slice("/files/".length);
  }
  return "/";
}
