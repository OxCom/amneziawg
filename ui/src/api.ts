import axios from "axios";
import type { Client, LinkResponse } from "./types";

export function makeApi(adminToken: string) {
  const http = axios.create({
    baseURL: "/", // same-origin behind your proxy
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
  });

  return {
    async health(): Promise<string> {
      const r = await axios.get("/api/health");
      return r.data;
    },

    async listClients(): Promise<Client[]> {
      const r = await http.get<Client[]>("/api/clients");
      return r.data;
    },

    async createClient(payload: { name: string; expiresAt?: string }): Promise<Client> {
      const r = await http.post<Client>("/api/clients", payload);
      return r.data;
    },

    async deleteClient(id: string): Promise<void> {
      await http.delete(`/api/clients/${id}`);
    },

    async createOneTimeLink(id: string, ttlSeconds = 3600): Promise<LinkResponse> {
      const r = await http.post<LinkResponse>(`/api/clients/${id}/link`, { ttlSeconds });
      return r.data;
    },
  };
}

export function absoluteUrl(urlPath: string): string {
  if (urlPath.startsWith("http://") || urlPath.startsWith("https://")) return urlPath;
  return `${window.location.origin}${urlPath}`;
}
