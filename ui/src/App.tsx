import React from "react";
import dayjs from "dayjs";
import toast from "react-hot-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { absoluteUrl, makeApi } from "./api";
import type { Client } from "./types";

function getStoredToken(): string {
  return sessionStorage.getItem("ADMIN_TOKEN") ?? "";
}
function setStoredToken(v: string) {
  sessionStorage.setItem("ADMIN_TOKEN", v);
}

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

export default function App() {
  const qc = useQueryClient();

  const [adminToken, setAdminToken] = React.useState<string>(getStoredToken());
  const api = React.useMemo(() => makeApi(adminToken), [adminToken]);

  const [newName, setNewName] = React.useState("");
  const [newExpiresAt, setNewExpiresAt] = React.useState<string>(""); // RFC3339 optional

  const authed = adminToken.trim().length > 0;

  const clientsQ = useQuery({
    queryKey: ["clients", adminToken],
    queryFn: () => api.listClients(),
    enabled: authed,
  });

  const createClientM = useMutation({
    mutationFn: () =>
      api.createClient({
        name: newName.trim(),
        expiresAt: newExpiresAt.trim() ? newExpiresAt.trim() : undefined,
      }),
    onSuccess: async () => {
      toast.success("Client created");
      setNewName("");
      setNewExpiresAt("");
      await qc.invalidateQueries({ queryKey: ["clients", adminToken] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Create failed"),
  });

  const deleteClientM = useMutation({
    mutationFn: (id: string) => api.deleteClient(id),
    onSuccess: async () => {
      toast.success("Client deleted");
      await qc.invalidateQueries({ queryKey: ["clients", adminToken] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const downloadM = useMutation({
    mutationFn: async (id: string) => {
      const link = await api.createOneTimeLink(id, 3600);
      const url = absoluteUrl(link.urlPath);
      window.location.href = url; // публичный /dl/<token>
      return link;
    },
    onError: (e: any) => toast.error(e?.message ?? "Download failed"),
  });

  const copyLinkM = useMutation({
    mutationFn: async (id: string) => {
      const link = await api.createOneTimeLink(id, 3600);
      const url = absoluteUrl(link.urlPath);
      await copyToClipboard(url);
      return { url, expiresAt: link.expiresAt };
    },
    onSuccess: (d) => toast.success(`Link copied (expires ${d.expiresAt})`),
    onError: (e: any) => toast.error(e?.message ?? "Copy failed"),
  });

  function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = adminToken.trim();
    if (!t) {
      toast.error("Token required");
      return;
    }
    setStoredToken(t);
    toast.success("Token saved (session)");
  }

  function logout() {
    setStoredToken("");
    setAdminToken("");
    qc.clear();
  }

  return (
    <div className="page">
      <header className="header">
        <div>
          <div className="title">AmneziaWG Admin UI</div>
          <div className="subtitle">Clients • One-time links • Config download</div>
        </div>
        {authed ? (
          <button className="btn btn-secondary" onClick={logout}>
            Logout
          </button>
        ) : null}
      </header>

      {!authed ? (
        <section className="card">
          <h2>Admin token</h2>
          <form onSubmit={onLoginSubmit} className="row">
            <input
              className="input"
              type="password"
              placeholder="ADMIN_TOKEN"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              autoComplete="off"
            />
            <button className="btn" type="submit">
              Save
            </button>
          </form>
          <div className="hint">
            Token хранится в sessionStorage. Для API используется заголовок Authorization: Bearer ...
          </div>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>Create client</h2>
            <div className="grid2">
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. android-ivan"
                />
              </div>
              <div>
                <label className="label">ExpiresAt (optional, RFC3339)</label>
                <input
                  className="input"
                  value={newExpiresAt}
                  onChange={(e) => setNewExpiresAt(e.target.value)}
                  placeholder='e.g. 2026-01-31T12:00:00Z'
                />
              </div>
            </div>
            <div className="row">
              <button
                className="btn"
                disabled={createClientM.isPending || !newName.trim()}
                onClick={() => createClientM.mutate()}
              >
                {createClientM.isPending ? "Creating..." : "Create"}
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Clients</h2>

            {clientsQ.isLoading ? <div>Loading...</div> : null}
            {clientsQ.isError ? (
              <div className="error">Failed: {(clientsQ.error as any)?.message ?? "error"}</div>
            ) : null}

            {clientsQ.data ? (
              <div className="table">
                <div className="tr th">
                  <div>Name</div>
                  <div>Address</div>
                  <div>Created</div>
                  <div>Expires</div>
                  <div className="actions">Actions</div>
                </div>

                {clientsQ.data.map((c) => (
                  <ClientRow
                    key={c.id}
                    c={c}
                    onCopy={() => copyLinkM.mutate(c.id)}
                    onDownload={() => downloadM.mutate(c.id)}
                    onDelete={() => deleteClientM.mutate(c.id)}
                    busy={copyLinkM.isPending || downloadM.isPending || deleteClientM.isPending}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </>
      )}

      <footer className="footer">
        <div>Server endpoints: /api/* (auth), /dl/* (one-time public download)</div>
      </footer>
    </div>
  );
}

function ClientRow(props: {
  c: Client;
  onCopy: () => void;
  onDownload: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { c, onCopy, onDownload, onDelete, busy } = props;
  const created = dayjs(c.createdAt).format("YYYY-MM-DD HH:mm");
  const expires = c.expiresAt ? dayjs(c.expiresAt).format("YYYY-MM-DD HH:mm") : "-";
  const expired = c.expiresAt ? dayjs().isAfter(dayjs(c.expiresAt)) : false;

  return (
    <div className={`tr ${expired ? "expired" : ""}`}>
      <div className="mono">{c.name}</div>
      <div className="mono">{c.address}</div>
      <div>{created}</div>
      <div>{expires}</div>
      <div className="actions">
        <button className="btn btn-secondary" onClick={onCopy} disabled={busy}>
          Copy link
        </button>
        <button className="btn" onClick={onDownload} disabled={busy}>
          Download
        </button>
        <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
          Delete
        </button>
      </div>
    </div>
  );
}
