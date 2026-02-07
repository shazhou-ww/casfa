import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi } from "../api/admin";

export function useUserList() {
  return useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const res = await adminApi.listUsers();
      return res.users;
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      adminApi.updateRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "users"] }),
  });
}
