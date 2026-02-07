import { useQuery } from "@tanstack/react-query";
import { filesystemApi } from "../api/filesystem";
import type { FsLsResponse } from "../api/types";

export function useDirectory(realm: string | null, root: string | null, path: string) {
  return useQuery<FsLsResponse>({
    queryKey: ["fs", "ls", realm, root, path],
    queryFn: () => filesystemApi.ls(realm!, root!, path),
    enabled: !!realm && !!root,
  });
}
