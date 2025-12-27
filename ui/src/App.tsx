import React from "react";
import dayjs from "dayjs";
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Paper,
  Stack,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Snackbar,
  IconButton,
  Tooltip,
  Chip,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import LogoutIcon from "@mui/icons-material/Logout";
import PasteIcon from "@mui/icons-material/ContentPaste";
import AddIcon from "@mui/icons-material/Add";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Client } from "./types";
import { makeApi, toAbsoluteUrl } from "./api";

const LS_KEY = "ADMIN_TOKEN";

function getToken(): string {
  return localStorage.getItem(LS_KEY) ?? "";
}
function setToken(v: string) {
  localStorage.setItem(LS_KEY, v);
}
function clearToken() {
  localStorage.removeItem(LS_KEY);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export default function App() {
  const qc = useQueryClient();

  const [adminToken, setAdminToken] = React.useState(getToken());
  const [tokenDialogOpen, setTokenDialogOpen] = React.useState(() => !getToken());

  const api = React.useMemo(() => makeApi(adminToken.trim()), [adminToken]);

  // Optional: accept ?token=... once, then remove from URL
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("token");
    if (t && t.trim()) {
      const tt = t.trim();
      setAdminToken(tt);
      setToken(tt);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.toString());
      setTokenDialogOpen(false);
    }
  }, []);

  const authed = adminToken.trim().length > 0;

  const [snack, setSnack] = React.useState<{ open: boolean; msg: string; severity: "success" | "error" | "info" }>({
    open: false,
    msg: "",
    severity: "info",
  });

  const show = (severity: "success" | "error" | "info", msg: string) =>
    setSnack({ open: true, msg, severity });

  const clientsQ = useQuery({
    queryKey: ["clients"],
    queryFn: () => api.listClients(),
    enabled: authed,
  });

  const createClientM = useMutation({
    mutationFn: (payload: { name: string; expiresAt?: string }) => api.createClient(payload),
    onSuccess: async () => {
      show("success", "Client created");
      await qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => show("error", e?.message ?? "Create failed"),
  });

  const deleteClientM = useMutation({
    mutationFn: (id: string) => api.deleteClient(id),
    onSuccess: async () => {
      show("success", "Client deleted");
      await qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => show("error", e?.message ?? "Delete failed"),
  });

  const downloadM = useMutation({
    mutationFn: async (id: string) => {
      const link = await api.createOneTimeLink(id, 3600);
      window.location.href = toAbsoluteUrl(link.urlPath); // публичный /dl/<token>
    },
    onError: (e: any) => show("error", e?.message ?? "Download failed"),
  });

  const copyLinkM = useMutation({
    mutationFn: async (id: string) => {
      const link = await api.createOneTimeLink(id, 3600);
      const url = toAbsoluteUrl(link.urlPath);
      await copyText(url);
      return link.expiresAt;
    },
    onSuccess: (expiresAt) => show("success", `Link copied (expires ${expiresAt})`),
    onError: (e: any) => show("error", e?.message ?? "Copy link failed"),
  });

  const [newName, setNewName] = React.useState("");
  const [newExpiresAt, setNewExpiresAt] = React.useState("");

  const rows = (clientsQ.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    address: c.address,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt ?? "",
  }));

  const columns: GridColDef[] = [
    { field: "name", headerName: "Name", flex: 1.2, minWidth: 160 },
    { field: "address", headerName: "Address", flex: 1, minWidth: 160 },
    {
      field: "createdAt",
      headerName: "Created",
      flex: 1,
      minWidth: 170,
      valueFormatter: (v) => (v.value ? dayjs(String(v.value)).format("YYYY-MM-DD HH:mm") : ""),
    },
    {
      field: "expiresAt",
      headerName: "Expires",
      flex: 1,
      minWidth: 170,
      valueFormatter: (v) => (v.value ? dayjs(String(v.value)).format("YYYY-MM-DD HH:mm") : "-"),
      renderCell: (params) => {
        const s = String(params.value || "");
        if (!s) return <span>-</span>;
        const expired = dayjs().isAfter(dayjs(s));
        return expired ? <Chip label="expired" size="small" color="warning" /> : <span>{dayjs(s).format("YYYY-MM-DD HH:mm")}</span>;
      },
    },
    {
      field: "actions",
      headerName: "Actions",
      sortable: false,
      filterable: false,
      width: 210,
      renderCell: (params) => {
        const id = String(params.row.id);
        const busy = downloadM.isPending || copyLinkM.isPending || deleteClientM.isPending;

        return (
          <Stack direction="row" spacing={1}>
            <Tooltip title="Copy one-time link">
              <span>
                <IconButton size="small" onClick={() => copyLinkM.mutate(id)} disabled={busy}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Download config (one-time)">
              <span>
                <IconButton size="small" onClick={() => downloadM.mutate(id)} disabled={busy}>
                  <DownloadIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>

            <Tooltip title="Delete client">
              <span>
                <IconButton size="small" onClick={() => deleteClientM.mutate(id)} disabled={busy}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        );
      },
    },
  ];

  const onSaveToken = () => {
    const t = adminToken.trim();
    if (!t) {
      show("error", "Token required");
      return;
    }
    setToken(t);
    setTokenDialogOpen(false);
    show("success", "Token saved");
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  const onLogout = () => {
    clearToken();
    setAdminToken("");
    setTokenDialogOpen(true);
    qc.clear();
  };

  return (
    <>
      <AppBar position="sticky" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            AmneziaWG Admin UI
          </Typography>
          {authed ? (
            <Button color="inherit" startIcon={<LogoutIcon />} onClick={onLogout}>
              Logout
            </Button>
          ) : (
            <Button color="inherit" onClick={() => setTokenDialogOpen(true)}>
              Set token
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        {!authed ? (
          <Paper sx={{ p: 2 }}>
            <Alert severity="info">
              Введите ADMIN_TOKEN. Он сохраняется в localStorage, поэтому вводить его каждый раз не нужно.
            </Alert>
            <Button sx={{ mt: 2 }} variant="contained" onClick={() => setTokenDialogOpen(true)}>
              Enter token
            </Button>
          </Paper>
        ) : (
          <Stack spacing={2}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                Create client
              </Typography>

              <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
                <TextField
                  label="Name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="ExpiresAt (RFC3339, optional)"
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  placeholder="2026-01-31T12:00:00Z"
                  fullWidth
                />
                <Button
                  variant="contained"
                  startIcon={<AddIcon />}
                  disabled={!newName.trim() || createClientM.isPending}
                  onClick={() =>
                    createClientM.mutate({
                      name: newName.trim(),
                      expiresAt: newExpiresAt.trim() ? newExpiresAt.trim() : undefined,
                    })
                  }
                >
                  Create
                </Button>
              </Stack>
            </Paper>

            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 600 }}>
                Clients
              </Typography>

              {clientsQ.isError ? (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {(clientsQ.error as any)?.message ?? "Failed to load clients"}
                </Alert>
              ) : null}

              <div style={{ height: 520, width: "100%" }}>
                <DataGrid
                  rows={rows}
                  columns={columns}
                  disableRowSelectionOnClick
                  loading={clientsQ.isLoading}
                  pageSizeOptions={[10, 25, 50]}
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                />
              </div>
            </Paper>
          </Stack>
        )}
      </Container>

      <Dialog open={tokenDialogOpen} onClose={() => setTokenDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Admin token</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              type="password"
              label="ADMIN_TOKEN"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              fullWidth
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<PasteIcon />}
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText();
                    if (t) setAdminToken(t.trim());
                  } catch {
                    show("error", "Clipboard read not permitted by browser");
                  }
                }}
              >
                Paste
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTokenDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={onSaveToken}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={3500}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <Alert
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: "100%" }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </>
  );
}
