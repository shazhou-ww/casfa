import {
  Box,
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
  Typography,
} from "@mui/material";
import { LoadingSpinner } from "../../../components/common/loading-spinner";
import { useDepotDetail } from "../../../hooks/use-depots";

type DepotDetailDialogProps = {
  realm: string | null;
  depotId: string | null;
  onClose: () => void;
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

export function DepotDetailDialog({ realm, depotId, onClose }: DepotDetailDialogProps) {
  const { data: depot, isLoading } = useDepotDetail(realm, depotId);

  return (
    <Dialog open={!!depotId} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Depot Details</DialogTitle>
      <DialogContent>
        {isLoading && <LoadingSpinner />}
        {depot && (
          <>
            <Table size="small" sx={{ mb: 2 }}>
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Depot ID</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                    {depot.depotId}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Title</TableCell>
                  <TableCell>{depot.title || "-"}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Current Root</TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: "0.85rem" }}>
                    {depot.root}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Max History</TableCell>
                  <TableCell>{depot.maxHistory}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                  <TableCell>{formatDate(depot.createdAt)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Updated</TableCell>
                  <TableCell>{formatDate(depot.updatedAt)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {depot.history && depot.history.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  History ({depot.history.length} snapshots)
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {depot.history.map((root, i) => (
                    <Chip
                      key={root}
                      label={`${i === 0 ? "current" : `v${depot.history.length - i}`}: ${root.slice(0, 20)}...`}
                      size="small"
                      variant={i === 0 ? "filled" : "outlined"}
                      color={i === 0 ? "primary" : "default"}
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        justifyContent: "flex-start",
                      }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
