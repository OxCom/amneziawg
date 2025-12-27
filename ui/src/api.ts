import axios from "axios";
import type { Client, LinkResponse } from "./types";

export function makeApi(adminToken: string) {
  const http = axios.create({
    baseURL: "/",
    timeout: 15000,
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  return {
    async listClients(): Promise<Client[]> {
      const r = await http.get("/api/clients", {
        headers: { Accept: "application/json" },
      });
      // Защита от ситуации, когда вместо JSON прилетает HTML (не тот прокси)
      if (!Array.isArray(r.data)) {
        const t = typeof r.data === "string" ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200);
        throw new Error(`Unexpected /api/clients response (expected array). Got: ${t}`);
      }
      return r.data as Client[];
    },

    async createClient(payload: { name: string; expiresAt?: string }): Promise<Client> {
      const r = await http.post<Client>("/api/clients", payload, {
        headers: { "Content-Type": "application/json" },
      });
      return r.data;
    },

    async deleteClient(id: string): Promise<void> {
      await http.delete(`/api/clients/${id}`);
    },

    async createOneTimeLink(id: string, ttlSeconds = 3600): Promise<LinkResponse> {
      const r = await http.post<LinkResponse>(`/api/clients/${id}/link`, { ttlSeconds }, {
        headers: { "Content-Type": "application/json" },
      });
      return r.data;
    },
  };
}

export function toAbsoluteUrl(urlPath: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) return urlPath;
  return `${window.location.origin}${urlPath}`;
}
