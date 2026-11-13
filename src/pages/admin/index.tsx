import { useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
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
      <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Admin</Typography>
      <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Reference data" />
        <Tab label="Templates" />
        <Tab label="Usage reports" />
      </Tabs>
      {tab === 0 ? <RefDataEditor /> : null}
      {tab === 1 ? <TemplatesPanel /> : null}
      {tab === 2 ? <UsageReports /> : null}
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
      <Typography variant="h2" component="h1" sx={{ mb: 2 }}>Usage reports</Typography>
      <UsageReports />
    </Box>
  );
};
