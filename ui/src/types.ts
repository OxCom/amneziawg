export type Client = {
  id: string;
  name: string;
  publicKey: string;
  address: string;
  createdAt: string;   // RFC3339
  expiresAt?: string;  // RFC3339
};

export type LinkResponse = {
  urlPath: string;     // e.g. /dl/<token>
  expiresAt: string;   // RFC3339
};
