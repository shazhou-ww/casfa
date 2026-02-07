import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@mui/material";
import { LoadingSpinner } from "../../../components/common/loading-spinner";
import { useTokenDetail } from "../../../hooks/use-tokens";

type TokenDetailDialogProps = {
  tokenId: string | null;
  onClose: () => void;
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function TokenDetailDialog({ tokenId, onClose }: TokenDetailDialogProps) {
  const { data: token, isLoading } = useTokenDetail(tokenId);

  return (
    <Dialog open={!!tokenId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Token Details</DialogTitle>
      <DialogContent>
        {isLoading && <LoadingSpinner />}
        {token && (
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Token ID</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                  {token.tokenId}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                <TableCell>{token.name || "-"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell>
                  <Chip label={token.type} size="small" variant="outlined" />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                <TableCell>
                  <Chip
                    label={token.isRevoked ? "Revoked" : "Active"}
                    size="small"
                    color={token.isRevoked ? "error" : "success"}
                  />
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Realm</TableCell>
                <TableCell sx={{ fontFamily: "monospace" }}>{token.realm}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Can Upload</TableCell>
                <TableCell>{token.canUpload ? "Yes" : "No"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Can Manage Depots</TableCell>
                <TableCell>{token.canManageDepot ? "Yes" : "No"}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                <TableCell>{formatDate(token.createdAt)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Expires</TableCell>
                <TableCell>{formatDate(token.expiresAt)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
