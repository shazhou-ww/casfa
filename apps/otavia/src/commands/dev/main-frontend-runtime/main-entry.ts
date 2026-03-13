export type MountLoaders = Record<string, () => Promise<unknown>>;

function normalizePathname(pathname: string): string {
  if (!pathname.endsWith("/")) return pathname + "/";
  return pathname;
}

function resolveMount(pathname: string, mounts: string[]): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mounts.includes(seg) ? seg : null;
}

export async function bootMainFrontend(
  rootRedirectMount: string,
  mounts: string[],
  mountLoaders: MountLoaders
): Promise<void> {
  const mount = resolveMount(window.location.pathname, mounts);
  if (!mount) {
    window.location.replace(`/${rootRedirectMount}/`);
    return;
  }
  const desiredPrefix = `/${mount}/`;
  if (!normalizePathname(window.location.pathname).startsWith(desiredPrefix)) {
    window.location.replace(desiredPrefix);
    return;
  }
  const load = mountLoaders[mount];
  if (!load) {
    window.location.replace(`/${rootRedirectMount}/`);
    return;
  }
  await load();
}
