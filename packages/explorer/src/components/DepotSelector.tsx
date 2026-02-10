/**
 * <DepotSelector /> - Displays available depots for selection.
 */

import { useEffect, useState } from "react";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from "@mui/material";
import { useExplorerStore, useExplorerT } from "../hooks/use-explorer-context.ts";

type DepotSelectorProps = {
  onSelect: (depotId: string) => void;
};

export function DepotSelector({ onSelect }: DepotSelectorProps) {
  const t = useExplorerT();
  const depots = useExplorerStore((s) => s.depots);
  const depotsLoading = useExplorerStore((s) => s.depotsLoading);
  const loadDepots = useExplorerStore((s) => s.loadDepots);

  const [search, setSearch] = useState("");

  useEffect(() => {
    loadDepots();
  }, [loadDepots]);

  const filtered = search
    ? depots.filter(
        (d) =>
          d.depotId.toLowerCase().includes(search.toLowerCase()) ||
          (d.title && d.title.toLowerCase().includes(search.toLowerCase())),
      )
    : depots;

  return (
    <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
      <Typography variant="h6" gutterBottom>
        {t("depot.title")}
      </Typography>

      <TextField
        size="small"
        fullWidth
        placeholder={t("depot.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        sx={{ mb: 2 }}
      />

      {depotsLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {!depotsLoading && filtered.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: "center", py: 4 }}>
          {t("depot.empty")}
        </Typography>
      )}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {filtered.map((depot) => (
          <Card key={depot.depotId} variant="outlined">
            <CardActionArea onClick={() => onSelect(depot.depotId)}>
              <CardContent sx={{ py: 1.5 }}>
                <Typography variant="subtitle2">
                  {depot.title || depot.depotId}
                </Typography>
                {depot.title && (
                  <Typography variant="caption" color="text.secondary">
                    {depot.depotId}
                  </Typography>
                )}
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
