function getToken() {
  return localStorage.getItem("adminToken") || "";
}
function saveToken() {
  localStorage.setItem("adminToken", document.getElementById("token").value.trim());
  alert("Saved");
}
async function api(path, opts={}) {
  const token = getToken();
  const headers = Object.assign({}, opts.headers || {}, {
    "Authorization": "Bearer " + token
  });
  return fetch(path, Object.assign({}, opts, { headers }));
}

async function loadClients() {
  const res = await api("/api/clients");
  if (!res.ok) { alert("Error: " + res.status); return; }
  const data = await res.json();

  const ul = document.getElementById("clients");
  ul.innerHTML = "";
  data.forEach(c => {
    const li = document.createElement("li");
    li.textContent = `${c.name} (${c.address})`;

    const dl = document.createElement("a");
    dl.href = `/api/clients/${encodeURIComponent(c.id)}/config`;
    dl.textContent = " download config";
    dl.style.marginLeft = "8px";

    const linkBtn = document.createElement("button");
    linkBtn.textContent = "one-time link";
    linkBtn.style.marginLeft = "8px";
    linkBtn.onclick = async () => {
      const r = await api(`/api/clients/${encodeURIComponent(c.id)}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlSeconds: 3600 })
      });
      if (!r.ok) { alert("link failed: " + r.status); return; }
      const j = await r.json();
      alert("Link path: " + j.urlPath + "\nExpires: " + j.expiresAt);
    };

    const del = document.createElement("button");
    del.textContent = "delete";
    del.style.marginLeft = "8px";
    del.onclick = async () => {
      const r = await api(`/api/clients/${encodeURIComponent(c.id)}`, { method: "DELETE" });
      if (!r.ok && r.status !== 204) alert("delete failed: " + r.status);
      await loadClients();
    };

    li.appendChild(dl);
    li.appendChild(linkBtn);
    li.appendChild(del);
    ul.appendChild(li);
  });
}

async function createClient() {
  const name = document.getElementById("name").value.trim();
  const expiry = document.getElementById("expiry").value.trim();
  const body = { name };
  if (expiry) body.expiresAt = expiry;

  const res = await api("/api/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) { alert("Error: " + res.status); return; }
  document.getElementById("name").value = "";
  document.getElementById("expiry").value = "";
  await loadClients();
}

document.getElementById("saveToken").onclick = saveToken;
document.getElementById("refresh").onclick = loadClients;
document.getElementById("createClient").onclick = createClient;

document.getElementById("token").value = getToken();
