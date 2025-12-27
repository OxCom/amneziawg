export type Client = {
  id: string;
  name: string;
  publicKey: string;
  address: string;
  createdAt: string;
  expiresAt?: string;
};

export type LinkResponse = {
  urlPath: string;
  expiresAt: string;
};
