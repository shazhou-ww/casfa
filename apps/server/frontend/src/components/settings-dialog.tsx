/**
 * SettingsDialog — full-screen modal for application settings.
 *
 * Currently has a single "Viewers" tab.
 * New tabs can be added by extending the `tabs` array.
 */

import CloseIcon from "@mui/icons-material/Close";
import VisibilityIcon from "@mui/icons-material/Visibility";
import {
  AppBar,
  Box,
  Dialog,
  IconButton,
  Slide,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from "@mui/material";
import type { TransitionProps } from "@mui/material/transitions";
import { forwardRef, useState } from "react";
import { ViewersSettings } from "./viewers-settings.tsx";

// ============================================================================
// Full-screen slide transition
// ============================================================================

const SlideUp = forwardRef(function SlideUp(
  props: TransitionProps & { children: React.ReactElement },
  ref: React.Ref<unknown>
) {
  return <Slide direction="up" ref={ref} {...props} />;
});

// ============================================================================
// Tab definitions
// ============================================================================

const tabs = [
  { key: "viewers", label: "Viewers", icon: <VisibilityIcon fontSize="small" /> },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function TabPanel({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      {children}
    </Box>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("viewers");

  return (
    <Dialog fullScreen open={open} onClose={onClose} TransitionComponent={SlideUp}>
      <AppBar position="static" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar>
          <Typography variant="h6" sx={{ flex: 1 }}>
            Settings
          </Typography>
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left sidebar tabs */}
        <Box
          sx={{
            width: 200,
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Tabs
            orientation="vertical"
            value={activeTab}
            onChange={(_, val) => setActiveTab(val as TabKey)}
            sx={{
              pt: 1,
              "& .MuiTab-root": {
                justifyContent: "flex-start",
                textTransform: "none",
                minHeight: 44,
                px: 2,
              },
            }}
          >
            {tabs.map((tab) => (
              <Tab
                key={tab.key}
                value={tab.key}
                label={tab.label}
                icon={tab.icon}
                iconPosition="start"
              />
            ))}
          </Tabs>
        </Box>

        {/* Tab content */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <TabPanel active={activeTab === "viewers"}>
            <ViewersSettings />
          </TabPanel>
        </Box>
      </Box>
    </Dialog>
  );
}
