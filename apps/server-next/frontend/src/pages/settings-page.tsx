import { Box, Tab, Tabs, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DelegatesTab } from "../components/settings/delegates-tab";

const DELEGATES_TAB = "delegates";

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const pathPart = location.pathname.replace(/^\/settings\/?/, "") || DELEGATES_TAB;
  const tabValue = pathPart === DELEGATES_TAB ? DELEGATES_TAB : DELEGATES_TAB;

  const [createOpen, setCreateOpen] = useState(false);

  const handleTabChange = useCallback(
    (_: React.SyntheticEvent, value: string) => {
      if (value === DELEGATES_TAB) {
        navigate("/settings/delegates", { replace: true });
      }
    },
    [navigate]
  );

  const handleCreateClick = useCallback(() => {
    setCreateOpen(true);
    // TODO: open create delegate dialog
  }, []);

  return (
    <Box sx={{ p: 3, height: "100%", overflow: "auto" }}>
      <Typography variant="h6" sx={{ mb: 2 }}>
        Settings
      </Typography>
      <Tabs value={tabValue} onChange={handleTabChange} sx={{ mb: 2 }}>
        <Tab label="Delegates" value={DELEGATES_TAB} />
      </Tabs>
      {tabValue === DELEGATES_TAB && (
        <DelegatesTab onCreateClick={handleCreateClick} />
      )}
    </Box>
  );
}
