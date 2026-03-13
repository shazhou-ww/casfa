export function buildForwardUrlForCellMount(rawUrl: string, prefix: string): URL {
  const url = new URL(rawUrl);
  const afterPrefix = url.pathname.slice(prefix.length) || "/";
  const newUrl = new URL(afterPrefix, url.origin);
  newUrl.search = url.search;
  return newUrl;
}
