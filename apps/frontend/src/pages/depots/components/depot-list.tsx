import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import { Chip, IconButton, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { DepotListItem } from "../../../api/types";

type DepotListProps = {
  depots: DepotListItem[];
  onViewDetail: (depotId: string) => void;
  onDelete: (depotId: string) => void;
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function DepotList({ depots, onViewDetail, onDelete }: DepotListProps) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Title</TableCell>
          <TableCell>Root</TableCell>
          <TableCell>History</TableCell>
          <TableCell>Updated</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {depots.map((depot) => (
          <TableRow key={depot.depotId} hover>
            <TableCell>{depot.title || depot.depotId.slice(0, 12)}</TableCell>
            <TableCell>
              <Chip
                label={depot.root.slice(0, 12)}
                size="small"
                variant="outlined"
                sx={{ fontFamily: "monospace", fontSize: "0.75rem" }}
              />
            </TableCell>
            <TableCell>{depot.maxHistory}</TableCell>
            <TableCell>{formatDate(depot.updatedAt)}</TableCell>
            <TableCell align="right">
              <IconButton size="small" title="Details" onClick={() => onViewDetail(depot.depotId)}>
                <InfoOutlined fontSize="small" />
              </IconButton>
              <IconButton
                size="small"
                title="Delete"
                color="error"
                onClick={() => onDelete(depot.depotId)}
              >
                <DeleteOutlined fontSize="small" />
              </IconButton>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
