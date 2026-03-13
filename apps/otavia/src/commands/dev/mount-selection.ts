export function resolveRootRedirectMount(
  mounts: string[],
  preferredMount?: string
): string {
  if (preferredMount && mounts.includes(preferredMount)) {
    return preferredMount;
  }
  return mounts[0] ?? "";
}
