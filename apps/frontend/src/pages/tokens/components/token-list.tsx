import BlockOutlined from "@mui/icons-material/BlockOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import { Chip, IconButton, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { TokenListItem } from "../../../api/types";

type TokenListProps = {
  tokens: TokenListItem[];
  onViewDetail: (tokenId: string) => void;
  onRevoke: (tokenId: string) => void;
};

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TokenList({ tokens, onViewDetail, onRevoke }: TokenListProps) {
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Name</TableCell>
          <TableCell>Type</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Permissions</TableCell>
          <TableCell>Expires</TableCell>
          <TableCell align="right">Actions</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {tokens.map((token) => (
          <TableRow key={token.tokenId} hover>
            <TableCell>{token.name || token.tokenId.slice(0, 12)}</TableCell>
            <TableCell>
              <Chip
                label={token.type}
                size="small"
                color={token.type === "delegate" ? "primary" : "default"}
                variant="outlined"
              />
            </TableCell>
            <TableCell>
              <Chip
                label={token.isRevoked ? "Revoked" : "Active"}
                size="small"
                color={token.isRevoked ? "error" : "success"}
              />
            </TableCell>
            <TableCell>
              {token.canUpload && <Chip label="Upload" size="small" sx={{ mr: 0.5 }} />}
              {token.canManageDepot && <Chip label="Depot" size="small" />}
            </TableCell>
            <TableCell>{formatDate(token.expiresAt)}</TableCell>
            <TableCell align="right">
              <IconButton size="small" title="Details" onClick={() => onViewDetail(token.tokenId)}>
                <InfoOutlined fontSize="small" />
              </IconButton>
              {!token.isRevoked && (
                <IconButton
                  size="small"
                  title="Revoke"
                  color="error"
                  onClick={() => onRevoke(token.tokenId)}
                >
                  <BlockOutlined fontSize="small" />
                </IconButton>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
