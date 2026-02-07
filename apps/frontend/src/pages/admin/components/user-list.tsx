import {
  Chip,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from "@mui/material";
import type { AdminUserInfo } from "../../../api/admin";
import { useUpdateRole } from "../../../hooks/use-admin";

type UserListProps = {
  users: AdminUserInfo[];
};

const ROLES = ["viewer", "editor", "admin"];

export function UserList({ users }: UserListProps) {
  const updateRole = useUpdateRole();

  const handleRoleChange = (userId: string, role: string) => {
    updateRole.mutate({ userId, role });
  };

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>User ID</TableCell>
          <TableCell>Role</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.userId} hover>
            <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
              {user.userId}
            </TableCell>
            <TableCell>
              <Select
                value={user.role}
                onChange={(e) => handleRoleChange(user.userId, e.target.value)}
                size="small"
                sx={{ minWidth: 120 }}
              >
                {ROLES.map((role) => (
                  <MenuItem key={role} value={role}>
                    <Chip label={role} size="small" variant="outlined" />
                  </MenuItem>
                ))}
              </Select>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
