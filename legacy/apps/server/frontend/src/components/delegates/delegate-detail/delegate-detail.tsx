/**
 * DelegateDetail — full information view for a single delegate.
 *
 * Fetches delegate data and composes the detail sections.
 */

import type { DelegateDetail as DelegateDetailType } from "@casfa/protocol";
import { ArrowBack as ArrowBackIcon } from "@mui/icons-material";
import { Alert, Box, CircularProgress, IconButton, Paper, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAppClient } from "../../../lib/client.ts";
import { type NotifyFn, Section } from "./detail-primitives.tsx";
import {
  BasicInfoSection,
  DelegationChain,
  DetailHeader,
  PermissionsSection,
  RevocationSection,
  StatusBar,
} from "./detail-sections.tsx";

type DelegateDetailProps = {
  delegateId: string;
  onRevokeClick?: () => void;
  onNotify?: NotifyFn;
};

export function DelegateDetail({ delegateId, onRevokeClick, onNotify }: DelegateDetailProps) {
  const navigate = useNavigate();
  const [delegate, setDelegate] = useState<DelegateDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAppClient().then((client) =>
      client.delegates.get(delegateId).then((result) => {
        if (result.ok) {
          setDelegate(result.data);
        } else {
          setError(result.error?.message ?? "Not found");
        }
        setLoading(false);
      })
    );
  }, [delegateId]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !delegate) {
    return (
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 3 }}>
          <IconButton onClick={() => navigate("/delegates")}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h5">Delegate Detail</Typography>
        </Box>
        <Alert severity="error">{error ?? "Failed to load delegate"}</Alert>
      </Box>
    );
  }

  return (
    <Box>
      <DetailHeader delegate={delegate} onRevokeClick={onRevokeClick} onNotify={onNotify} />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <StatusBar delegate={delegate} />
        <BasicInfoSection delegate={delegate} />
        <PermissionsSection delegate={delegate} onNotify={onNotify} />
        <Section title="Delegation Chain">
          <DelegationChain chain={delegate.chain} currentId={delegate.delegateId} />
        </Section>
        <RevocationSection delegate={delegate} />
        <Paper variant="outlined" sx={{ px: 2.5, py: 2, bgcolor: "rgba(0, 0, 0, 0.01)" }}>
          <Typography variant="body2" color="text.secondary">
            To view this delegate's children, use the CLI or API with this delegate's token.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
