import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import StorageRoundedIcon from "@mui/icons-material/StorageRounded";
import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { PageHero } from "../../components";
import { RefDataEditor } from "./RefDataEditor";
import { TemplatesPanel } from "./TemplatesPanel";
import { UsageReports } from "./UsageReports";
import { useNipAccess } from "../../lib/useNipAccess";

/** Admin area. The policies are the real guard; this page only hides itself from other roles. */
export const AdminPage = () => {
  const { isAdmin, isLoading } = useNipAccess();
  const [tab, setTab] = useState(0);
  if (isLoading) return null;
  if (!isAdmin) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Alert severity="warning">The admin area is only available to administrators.</Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <PageHero
          icon={<AdminPanelSettingsRoundedIcon />}
          title="Admin"
          subtitle="Manage reference data, worksheet templates and usage reports."
        />
        <Paper sx={{ p: { xs: 2, md: 3 }, border: 1, borderColor: "divider" }}>
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5 }}>
            <Tab icon={<StorageRoundedIcon />} iconPosition="start" label="Reference data" />
            <Tab icon={<UploadFileRoundedIcon />} iconPosition="start" label="Templates" />
            <Tab icon={<InsightsRoundedIcon />} iconPosition="start" label="Usage reports" />
          </Tabs>
          {tab === 0 ? <RefDataEditor /> : null}
          {tab === 1 ? <TemplatesPanel /> : null}
          {tab === 2 ? <UsageReports /> : null}
        </Paper>
      </Stack>
    </Box>
  );
};

/** Usage reports page for reviewers (read-only) and admins. */
export const ReportsPage = () => {
  const { isAdmin, isReviewer, isLoading } = useNipAccess();
  if (isLoading) return null;
  if (!isAdmin && !isReviewer) {
    return (
      <Box sx={{ p: { xs: 2, md: 3 } }}>
        <Alert severity="warning">Usage reports are available to reviewers and administrators.</Alert>
      </Box>
    );
  }
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack spacing={2.5}>
        <PageHero icon={<InsightsRoundedIcon />} title="Usage reports" subtitle="Read-only counts across all runs." />
        <UsageReports />
      </Stack>
    </Box>
  );
};
