import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useState } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import {
  useApproveRequest,
  useRejectRequest,
  useTokenRequest,
} from "../../hooks/use-token-requests";
import { AuthorizeLogin } from "./components/authorize-login";
import { RequestInfo } from "./components/request-info";

type ApproveFormState = {
  name: string;
  type: "delegate" | "access";
  expiresIn: number;
  canUpload: boolean;
  canManageDepot: boolean;
  scope: string;
};

const EXPIRY_OPTIONS = [
  { label: "1 day", value: 86400 },
  { label: "7 days", value: 86400 * 7 },
  { label: "30 days", value: 86400 * 30 },
  { label: "90 days", value: 86400 * 90 },
];

export function AuthorizePage() {
  const { requestId } = useParams<{ requestId: string }>();
  const { isAuthenticated, user } = useAuth();
  const { data: request, isLoading, error } = useTokenRequest(requestId ?? null);
  const approveMutation = useApproveRequest();
  const rejectMutation = useRejectRequest();
  const [result, setResult] = useState<"approved" | "rejected" | null>(null);

  const [form, setForm] = useState<ApproveFormState>({
    name: "agent-delegate",
    type: "delegate",
    expiresIn: 86400 * 30,
    canUpload: true,
    canManageDepot: true,
    scope: "cas://depot:*",
  });

  const handleApprove = useCallback(async () => {
    if (!requestId || !user) return;
    const realm = user.realm;
    await approveMutation.mutateAsync({
      requestId,
      realm,
      name: form.name,
      type: form.type,
      expiresIn: form.expiresIn,
      canUpload: form.canUpload,
      canManageDepot: form.canManageDepot,
      scope: [form.scope],
    });
    setResult("approved");
  }, [requestId, user, form, approveMutation]);

  const handleReject = useCallback(async () => {
    if (!requestId) return;
    await rejectMutation.mutateAsync(requestId);
    setResult("rejected");
  }, [requestId, rejectMutation]);

  if (!isAuthenticated) {
    return <AuthorizeLogin />;
  }

  if (isLoading) {
    return (
      <CenteredBox>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading request...</Typography>
      </CenteredBox>
    );
  }

  if (error || !request) {
    return (
      <CenteredBox>
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          {error instanceof Error ? error.message : "Request not found or has expired."}
        </Alert>
      </CenteredBox>
    );
  }

  if (request.status !== "pending") {
    return (
      <CenteredBox>
        <Alert severity="info" sx={{ maxWidth: 400 }}>
          This request has already been {request.status}.
        </Alert>
      </CenteredBox>
    );
  }

  if (result) {
    return (
      <CenteredBox>
        <Alert severity={result === "approved" ? "success" : "info"} sx={{ maxWidth: 400 }}>
          Request {result}. You can close this window.
        </Alert>
      </CenteredBox>
    );
  }

  return (
    <Box sx={{ maxWidth: 480, mx: "auto", p: 3 }}>
      <Typography variant="h5" sx={{ mb: 3, fontWeight: 600 }}>
        Authorize Access
      </Typography>

      <RequestInfo request={request} />

      <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>
        Token Configuration
      </Typography>

      <Stack spacing={2}>
        <TextField
          label="Token Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          size="small"
          fullWidth
        />
        <TextField
          label="Token Type"
          value={form.type}
          onChange={(e) =>
            setForm((f) => ({ ...f, type: e.target.value as "delegate" | "access" }))
          }
          select
          size="small"
          fullWidth
        >
          <MenuItem value="delegate">Delegate</MenuItem>
          <MenuItem value="access">Access</MenuItem>
        </TextField>
        <TextField
          label="Expires In"
          value={form.expiresIn}
          onChange={(e) => setForm((f) => ({ ...f, expiresIn: Number(e.target.value) }))}
          select
          size="small"
          fullWidth
        >
          {EXPIRY_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Scope"
          value={form.scope}
          onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value }))}
          size="small"
          fullWidth
          helperText='CAS URI scope, e.g. "cas://depot:*" for all depots'
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={form.canUpload}
              onChange={(e) => setForm((f) => ({ ...f, canUpload: e.target.checked }))}
            />
          }
          label="Can Upload"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={form.canManageDepot}
              onChange={(e) => setForm((f) => ({ ...f, canManageDepot: e.target.checked }))}
            />
          }
          label="Can Manage Depots"
        />
      </Stack>

      {approveMutation.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {approveMutation.error instanceof Error
            ? approveMutation.error.message
            : "Failed to approve request."}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ mt: 3, justifyContent: "flex-end" }}>
        <Button
          variant="outlined"
          color="error"
          onClick={handleReject}
          disabled={rejectMutation.isPending || approveMutation.isPending}
        >
          {rejectMutation.isPending ? "Rejecting..." : "Reject"}
        </Button>
        <Button
          variant="contained"
          onClick={handleApprove}
          disabled={approveMutation.isPending || rejectMutation.isPending}
        >
          {approveMutation.isPending ? "Approving..." : "Approve"}
        </Button>
      </Stack>
    </Box>
  );
}

function CenteredBox({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        p: 3,
      }}
    >
      {children}
    </Box>
  );
}
