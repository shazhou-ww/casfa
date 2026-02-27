/**
 * Section-level components for the delegate detail view:
 * DetailHeader, StatusBar, BasicInfoSection, PermissionsSection,
 * RevocationSection, DelegationChain.
 */

import type { DelegateDetail } from "@casfa/protocol";
import {
  ArrowBack as ArrowBackIcon,
  Block as BlockIcon,
  CloudUpload,
  ContentCopy as ContentCopyIcon,
  NavigateNext as NavigateNextIcon,
  Storage,
} from "@mui/icons-material";
import {
  Box,
  Breadcrumbs,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../../stores/auth-store.ts";
import {
  CopyButton,
  CopyableChip,
  InfoRow,
  PermissionCard,
  Section,
  formatRelativeExpiry,
  formatTime,
  getStatus,
  statusConfig,
  type NotifyFn,
} from "./detail-primitives.tsx";

// -- DetailHeader -----------------------------------------------------------

export function DetailHeader({
  delegate,
  onRevokeClick,
  onNotify,
}: {
  delegate: DelegateDetail;
  onRevokeClick?: () => void;
  onNotify?: NotifyFn;
}) {
  const navigate = useNavigate();
  const cfg = statusConfig[getStatus(delegate)];

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        mb: 3,
        flexWrap: "wrap",
      }}
    >
      <IconButton
        onClick={() => navigate("/delegates")}
        size="small"
        sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}
      >
        <ArrowBackIcon fontSize="small" />
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography
            variant="h6"
            sx={{
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {delegate.name || `Delegate ${delegate.delegateId.slice(0, 12)}…`}
          </Typography>
          <Chip
            label={cfg.label}
            color={cfg.color}
            size="small"
            variant="outlined"
            sx={{ fontWeight: 500 }}
          />
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
          {delegate.delegateId}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<ContentCopyIcon />}
          onClick={() => {
            navigator.clipboard.writeText(delegate.delegateId);
            onNotify?.("Delegate ID copied", "info");
          }}
        >
          Copy ID
        </Button>
        {!delegate.isRevoked && (
          <Button
            variant="outlined"
            size="small"
            color="error"
            startIcon={<BlockIcon />}
            onClick={onRevokeClick}
          >
            Revoke
          </Button>
        )}
      </Box>
    </Box>
  );
}

// -- StatusBar --------------------------------------------------------------

function StatItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>
        {children}
      </Typography>
    </Box>
  );
}

export function StatusBar({ delegate }: { delegate: DelegateDetail }) {
  const cfg = statusConfig[getStatus(delegate)];

  return (
    <Paper variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ height: 3, bgcolor: cfg.barColor }} />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 3,
          px: 2.5,
          py: 1.5,
          flexWrap: "wrap",
        }}
      >
        <StatItem label="Status">{cfg.label}</StatItem>
        <Divider orientation="vertical" flexItem />
        <StatItem label="Depth">{delegate.depth}</StatItem>
        <Divider orientation="vertical" flexItem />
        <StatItem label="Created">{formatTime(delegate.createdAt)}</StatItem>
        <Divider orientation="vertical" flexItem />
        <StatItem label="Expires">
          {delegate.expiresAt != null ? (
            <Tooltip title={formatTime(delegate.expiresAt)}>
              <span>{formatRelativeExpiry(delegate.expiresAt)}</span>
            </Tooltip>
          ) : (
            "Never"
          )}
        </StatItem>
      </Box>
    </Paper>
  );
}

// -- BasicInfoSection -------------------------------------------------------

export function BasicInfoSection({ delegate }: { delegate: DelegateDetail }) {
  return (
    <Section title="Basic Info">
      <InfoRow label="ID">
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.85em" }}>
            {delegate.delegateId}
          </Typography>
          <CopyButton text={delegate.delegateId} />
        </Box>
      </InfoRow>
      {delegate.name && (
        <InfoRow label="Name">
          <Typography variant="body2">{delegate.name}</Typography>
        </InfoRow>
      )}
      <InfoRow label="Realm" last>
        <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.85em" }}>
          {delegate.realm}
        </Typography>
      </InfoRow>
    </Section>
  );
}

// -- PermissionsSection -----------------------------------------------------

export function PermissionsSection({
  delegate,
  onNotify,
}: {
  delegate: DelegateDetail;
  onNotify?: NotifyFn;
}) {
  return (
    <Section title="Permissions">
      <Box sx={{ display: "flex", gap: 1.5, mb: 2 }}>
        <PermissionCard
          icon={<CloudUpload fontSize="small" />}
          label="Upload Nodes"
          allowed={delegate.canUpload}
        />
        <PermissionCard
          icon={<Storage fontSize="small" />}
          label="Manage Depots"
          allowed={delegate.canManageDepot}
        />
      </Box>

      {delegate.delegatedDepots && delegate.delegatedDepots.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
            Delegated Depots
          </Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
            {delegate.delegatedDepots.map((depotId) => (
              <CopyableChip
                key={depotId}
                value={depotId}
                maxLen={16}
                icon={<Storage />}
                onNotify={onNotify}
                notifyMessage="Depot ID copied"
              />
            ))}
          </Box>
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: "block" }}>
          Scope
        </Typography>
        {delegate.scopeNodeHash ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Single scope</Typography>
            <CopyableChip
              value={delegate.scopeNodeHash}
              maxLen={24}
              onNotify={onNotify}
              notifyMessage="Scope hash copied"
            />
          </Box>
        ) : delegate.scopeSetNodeId ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">Multi-scope set</Typography>
            <CopyableChip
              value={delegate.scopeSetNodeId}
              maxLen={24}
              onNotify={onNotify}
              notifyMessage="Scope set ID copied"
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No scope restriction (full access)
          </Typography>
        )}
      </Box>
    </Section>
  );
}

// -- DelegationChain --------------------------------------------------------

export function DelegationChain({
  chain,
  currentId,
}: {
  chain: string[];
  currentId: string;
}) {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  return (
    <Breadcrumbs separator={<NavigateNextIcon fontSize="small" />}>
      {chain.map((id, index) => {
        const isRoot =
          index === 0 || (user?.rootDelegateId != null && id === user.rootDelegateId);
        const isCurrent = id === currentId;
        const label = isRoot
          ? `Root (${id.slice(0, 8)}…)`
          : isCurrent
            ? `Current (${id.slice(0, 8)}…)`
            : `${id.slice(0, 8)}…`;

        return (
          <Chip
            key={id}
            label={label}
            size="small"
            variant={isCurrent ? "filled" : "outlined"}
            color={isRoot ? "default" : "primary"}
            sx={{ fontFamily: "monospace", fontSize: "0.8em" }}
            onClick={
              !isCurrent && !isRoot
                ? () => navigate(`/delegates/${encodeURIComponent(id)}`)
                : undefined
            }
          />
        );
      })}
    </Breadcrumbs>
  );
}

// -- RevocationSection ------------------------------------------------------

export function RevocationSection({ delegate }: { delegate: DelegateDetail }) {
  if (!delegate.isRevoked) return null;

  return (
    <Paper
      variant="outlined"
      sx={{ overflow: "hidden", borderColor: "rgba(161, 161, 170, 0.4)" }}
    >
      <Box sx={{ height: 3, bgcolor: "#a1a1aa" }} />
      <Box sx={{ px: 2.5, py: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, letterSpacing: "0.02em", mb: 1.5 }}>
          Revocation
        </Typography>
        {delegate.revokedAt != null && (
          <InfoRow label="Revoked At" last={!delegate.revokedBy}>
            <Typography variant="body2">{formatTime(delegate.revokedAt)}</Typography>
          </InfoRow>
        )}
        {delegate.revokedBy && (
          <InfoRow label="Revoked By" last>
            <Typography variant="body2" sx={{ fontFamily: "monospace", fontSize: "0.85em" }}>
              {delegate.revokedBy}
            </Typography>
          </InfoRow>
        )}
      </Box>
    </Paper>
  );
}
