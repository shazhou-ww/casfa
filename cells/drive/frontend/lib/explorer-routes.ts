/**
 * Explorer path <-> frontend route mapping.
 * - Path "/" -> route "/files"
 * - Path "/Documents" -> route "/files/Documents"
 */

export function pathToRoute(path: string): string {
  const p = (path || "/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
  if (p === "/") return "/files";
  const encodedPath = p
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/files/${encodedPath}`;
}

export function routeToPath(pathname: string): string {
  if (!pathname || pathname === "/" || pathname === "/files" || pathname === "/files/") {
    return "/";
  }
  if (pathname.startsWith("/files/")) {
    const rawPath = pathname.slice("/files/".length);
    const decodedPath = rawPath
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    return decodedPath ? `/${decodedPath}` : "/";
  }
  return "/";
}
