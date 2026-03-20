# AmneziaWG Manager

AmneziaWG Manager is a self-hosted web-based management tool for **AmneziaWG (WireGuard-based VPN)**. It allows you to manage VPN clients, generate configurations, and distribute them securely via a simple web UI.

The project is designed to run entirely in Docker and provides a minimal control plane for managing an AmneziaWG server without manual configuration edits.

---

## 🚀 Overview

AmneziaWG Manager provides:

- Centralized VPN client management
- Automatic configuration generation
- One-time download links for client configs
- Web UI for administration
- Fully containerized deployment

---

## ⚙️ Requirements

- Docker
- Docker Compose v2
- Public domain pointing to your server
- Open ports:
  - `80/tcp`
  - `443/tcp`
  - `51820/udp` (or custom WireGuard port)

---

## 💾 Data Storage

Persistent data is stored in `data/server/`

Includes:
- `server.json`
- `clients.json`
- `dl-tokens.json`
- `wg0.conf` (or custom interface) - will be generated on each start of application

Optional overrides:
- `client-extra-interface.txt` - will be injected into client's configurations
- `client-allowedips.txt`
- `server-extra-interface.txt` - will be injected into server's configuration

---

## 🛠️ Quick setup

1. Clone repository
  ```bash
  git clone https://github.com/OxCom/amneziawg.git
  cd amneziawg
  ```
   
2. Run setup script
  ```bash
  chmod +x scripts/setup.sh
  ./scripts/setup.sh
  ```

  This will:
  
  - Generate `.env`
  - Create required directories
  - Prepare Nginx config

3. Obtain SSL certificates
  ```bash
  docker compose -f docker-compose.bootstrap.yml up -d
  docker compose -f docker-compose.bootstrap.yml run --rm certbot
  docker compose -f docker-compose.bootstrap.yml down
  ```

4. Start services
  ```bash
  docker compose up -d
  ```

# 🔧 Configuration
Example of `.env`
```env
IMAGE_TAG=1.0.0
DOMAIN=vpn.example.com
CERTBOT_EMAIL=admin@example.com

WG_IFACE=wg0
WG_PORT=51820
WG_SUBNET=10.8.0.0/24
WG_ADDRESS=10.8.0.1/24
WG_ENDPOINT=vpn.example.com:51820

ADMIN_TOKEN=your_secure_token
```

---

# 🔐 Security Notes

- `ADMIN_TOKEN` is required for all API access
- One-time links (/dl/{token}):
  - expire after use
  - are publicly accessible until consumed
- Private keys are stored server-side and not exposed via API

Private keys are stored server-side and not exposed via API

---

# ⚠️ Notes & Limitations

- No role-based access control (single admin token)
- No built-in HA / clustering
- Assumes full control over host networking (NET_ADMIN)
- Minimal validation and observability
