import { Authenticated, Refine } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import {
  ErrorComponent,
  RefineSnackbarProvider,
  ThemedLayout,
  useNotificationProvider,
} from "@refinedev/mui";
import Navkit from '@taruvi/navkit';
import Box from "@mui/material/Box";
import CssBaseline from "@mui/material/CssBaseline";
import GlobalStyles from "@mui/material/GlobalStyles";
import routerProvider, { DocumentTitleHandler } from "@refinedev/react-router";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router";
import { taruviClient } from "./taruviClient";
import {
  taruviDataProvider,
  taruviAuthProvider,
  taruviStorageProvider,
  taruviAppProvider,
  taruviUserProvider,
  // taruviAccessControlProvider, // Uncomment to enable Cerbos-based access control
} from "./providers/refineProviders";
import { CustomSider, ErrorBoundary, UnsavedChangesDialog } from "./components";
import { LoginRedirect } from "./components/auth/LoginRedirect";
import { ColorModeContextProvider, ColorModeContext } from "./contexts/color-mode";
import {AppSettingsProvider, useAppSettings} from "./contexts/app-settings";
import { useContext, useRef, useEffect } from "react";
import { Login } from "./pages/login";
import { RunsList } from "./pages/runs/list";
import { RunShow } from "./pages/runs/show";
import { AdminPage, ReportsPage } from "./pages/admin";
import FolderOpenRoundedIcon from "@mui/icons-material/FolderOpenRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import AdminPanelSettingsRoundedIcon from "@mui/icons-material/AdminPanelSettingsRounded";
import { useNavkitProfileMenuItems } from "./navkit/useNavkitProfileMenuItems";

const AppContent = () => {
  const { setMode } = useContext(ColorModeContext);
  const navRef = useRef<HTMLDivElement>(null);
  const { settings } = useAppSettings()
  const profileMenuItems = useNavkitProfileMenuItems();

  useEffect(() => {
    if (navRef.current) {
      const height = navRef.current.offsetHeight;
      document.documentElement.style.setProperty('--nav-height', `${height}px`);
    }
  }, []);

  return (
    <>
      <div
        ref={navRef}
        data-nav-container
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1300,
          width: '100%',
        }}
      >
        <Navkit
          client={taruviClient}
          getTheme={(theme) => setMode(theme)}
          profileMenuItems={profileMenuItems}
        />
      </div>
      <RefineSnackbarProvider>
            <DevtoolsProvider>
              <Refine
                dataProvider={{
                  default: taruviDataProvider,
                  storage: taruviStorageProvider,
                  app: taruviAppProvider,
                  user: taruviUserProvider,
                }}
                notificationProvider={useNotificationProvider}
                routerProvider={routerProvider}
                authProvider={taruviAuthProvider}
                // accessControlProvider={taruviAccessControlProvider} // Uncomment to enable Cerbos-based access control
                resources={[
                  {
                    name: "nip_runs",
                    list: "/runs",
                    show: "/runs/show/:id",
                    meta: { label: "Runs", icon: <FolderOpenRoundedIcon /> },
                  },
                  {
                    name: "usage-reports",
                    list: "/usage-reports",
                    meta: { label: "Usage reports", icon: <AssessmentRoundedIcon />, requiresRole: "nip_reviewer" },
                  },
                  {
                    name: "admin",
                    list: "/admin",
                    meta: { label: "Admin", icon: <AdminPanelSettingsRoundedIcon />, requiresRole: "nip_admin" },
                  },
                ]}
                options={{
                  syncWithLocation: true,
                  warnWhenUnsavedChanges: true,
                  projectId: "obEpHJ-M7JimA-31GF1J",
                }}
              >
                <Routes>
                  <Route
                    element={
                      <Authenticated
                        key="login-route"
                        fallback={<Outlet />}
                      >
                        <Navigate to="/" replace />
                      </Authenticated>
                    }
                  >
                    <Route path="/login" element={<Login />} />
                  </Route>
                  <Route
                    element={
                      <Authenticated
                        key="authenticated-inner"
                        fallback={<LoginRedirect />}
                      >
                        <ThemedLayout
                          Header={() => null}
                          Sider={CustomSider}
                          initialSiderCollapsed={true}
                          childrenBoxProps={{ sx: { p: 0 } }}
                        >
                          <Box sx={{ ml: { xs: 0, md: '72px' }, transition: 'margin-left 0.2s ease-in-out' }}>
                            <ErrorBoundary>
                              <Outlet />
                            </ErrorBoundary>
                          </Box>
                        </ThemedLayout>
                      </Authenticated>
                    }
                  >
                    <Route index element={<Navigate to="/runs" replace />} />
                    <Route path="/runs" element={<RunsList />} />
                    <Route path="/runs/show/:id" element={<RunShow />} />
                    <Route path="/usage-reports" element={<ReportsPage />} />
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="*" element={<ErrorComponent />} />
                  </Route>
                </Routes>

                <RefineKbar />
                <UnsavedChangesDialog />
                <DocumentTitleHandler handler={() => settings?.displayName || ""}/>
              </Refine>
              <DevtoolsPanel />
            </DevtoolsProvider>
          </RefineSnackbarProvider>
    </>
  );
};

function App() {
  return (
    <BrowserRouter>
      <RefineKbarProvider>
        <ColorModeContextProvider>
          <AppSettingsProvider>
            <CssBaseline />
            <GlobalStyles
              styles={{
                html: { WebkitFontSmoothing: 'antialiased' },
                body: { fontFamily: "'Open Sans', sans-serif" },
                'h1, h2, h3, h4, h5, h6': { fontFamily: "'Quicksand', sans-serif" },
                '*::-webkit-scrollbar': { width: 8, height: 8 },
                '*::-webkit-scrollbar-track': { background: 'transparent' },
                '*::-webkit-scrollbar-thumb': {
                  background: 'rgba(0,0,0,0.18)',
                  borderRadius: 8,
                },
                '*::-webkit-scrollbar-thumb:hover': { background: 'rgba(0,0,0,0.32)' },
                '[data-theme="dark"] *::-webkit-scrollbar-thumb': {
                  background: 'rgba(255,255,255,0.18)',
                },
              }}
            />
            <AppContent />
          </AppSettingsProvider>
        </ColorModeContextProvider>
      </RefineKbarProvider>
    </BrowserRouter>
  );
}

export default App;
