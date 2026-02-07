import { useCallback } from "react";
import { filesystemApi } from "../api/filesystem";
import { useAuth } from "../auth/auth-context";
import { useFileBrowserStore } from "../stores/file-browser-store";

export function useFileDownload() {
  const { user } = useAuth();
  const realm = user?.realm ?? null;
  const { currentRoot, currentPath } = useFileBrowserStore();

  const download = useCallback(
    async (fileName: string) => {
      if (!realm || !currentRoot) return;
      const path = currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;
      const response = await filesystemApi.read(realm, currentRoot, path);
      const blob = await (response as unknown as Response).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [realm, currentRoot, currentPath]
  );

  return { download };
}
