import { useMutation, useQueryClient } from "@tanstack/react-query";
import { depotsApi } from "../api/depots";
import { filesystemApi } from "../api/filesystem";
import { useFileBrowserStore } from "../stores/file-browser-store";

type MutationContext = {
  realm: string;
  depotId: string;
};

/** Commits new root to depot and updates store */
async function commitAndUpdate(ctx: MutationContext, newRoot: string) {
  await depotsApi.commit(ctx.realm, ctx.depotId, newRoot);
  useFileBrowserStore.getState().setRoot(newRoot);
}

export function useFileMutations(realm: string | null, ctx: MutationContext | null) {
  const queryClient = useQueryClient();
  const root = useFileBrowserStore((s) => s.currentRoot);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["fs"] });
    queryClient.invalidateQueries({ queryKey: ["depots"] });
  };

  const mkdir = useMutation({
    mutationFn: async (path: string) => {
      if (!realm || !root || !ctx) throw new Error("Not initialized");
      const res = await filesystemApi.mkdir(realm, root, path);
      await commitAndUpdate(ctx, res.newRoot);
      return res;
    },
    onSuccess: invalidate,
  });

  const rm = useMutation({
    mutationFn: async (path: string) => {
      if (!realm || !root || !ctx) throw new Error("Not initialized");
      const res = await filesystemApi.rm(realm, root, path);
      await commitAndUpdate(ctx, res.newRoot);
      return res;
    },
    onSuccess: invalidate,
  });

  const mv = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      if (!realm || !root || !ctx) throw new Error("Not initialized");
      const res = await filesystemApi.mv(realm, root, from, to);
      await commitAndUpdate(ctx, res.newRoot);
      return res;
    },
    onSuccess: invalidate,
  });

  const cp = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      if (!realm || !root || !ctx) throw new Error("Not initialized");
      const res = await filesystemApi.cp(realm, root, from, to);
      await commitAndUpdate(ctx, res.newRoot);
      return res;
    },
    onSuccess: invalidate,
  });

  const write = useMutation({
    mutationFn: async ({
      path,
      data,
      contentType,
    }: {
      path: string;
      data: Uint8Array;
      contentType: string;
    }) => {
      if (!realm || !root || !ctx) throw new Error("Not initialized");
      const res = await filesystemApi.write(realm, root, path, data, contentType);
      await commitAndUpdate(ctx, res.newRoot);
      return res;
    },
    onSuccess: invalidate,
  });

  return { mkdir, rm, mv, cp, write };
}
