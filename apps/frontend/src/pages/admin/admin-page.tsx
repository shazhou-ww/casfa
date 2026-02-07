import AdminPanelSettingsOutlined from "@mui/icons-material/AdminPanelSettingsOutlined";
import { Box, Typography } from "@mui/material";
import { ErrorView } from "../../components/common/error-view";
import { LoadingSpinner } from "../../components/common/loading-spinner";
import { useUserList } from "../../hooks/use-admin";
import { UserList } from "./components/user-list";

export function AdminPage() {
  const { data: users, isLoading, error, refetch } = useUserList();

  return (
    <Box>
      <Typography variant="h5" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <AdminPanelSettingsOutlined /> Admin
      </Typography>

      <Typography variant="h6" sx={{ mt: 2, mb: 1 }}>
        Users
      </Typography>

      {isLoading && <LoadingSpinner />}
      {error && (
        <ErrorView
          message={error instanceof Error ? error.message : "Failed to load users"}
          onRetry={() => refetch()}
        />
      )}
      {users && users.length === 0 && (
        <Typography color="text.secondary">No users found.</Typography>
      )}
      {users && users.length > 0 && <UserList users={users} />}
    </Box>
  );
}
