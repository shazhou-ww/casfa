import { firstMount, mountLoaders, mounts } from "./generated/mount-loaders";

function normalizePathname(pathname: string): string {
  if (!pathname.endsWith("/")) return pathname + "/";
  return pathname;
}

function resolveMount(pathname: string): string | null {
  const seg = pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  return mounts.includes(seg) ? seg : null;
}

async function boot(): Promise<void> {
  const mount = resolveMount(window.location.pathname);
  if (!mount) {
    window.location.replace(`/${firstMount}/`);
    return;
  }
  const desiredPrefix = `/${mount}/`;
  if (!normalizePathname(window.location.pathname).startsWith(desiredPrefix)) {
    window.location.replace(desiredPrefix);
    return;
  }
  const load = mountLoaders[mount];
  if (!load) {
    window.location.replace(`/${firstMount}/`);
    return;
  }
  await load();
}

void boot();
