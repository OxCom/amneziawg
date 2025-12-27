#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"
NGINX_DIST="nginx.conf.dist"
NGINX_CONF="nginx.conf"
DATA_DIR="data"

err() { echo "ERROR: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || err "Command not found: $1"; }

ask() {
  local prompt="$1"; local def="${2:-}"
  local val=""
  if [[ -n "$def" ]]; then
    read -r -p "${prompt} [${def}]: " val
    val="${val:-$def}"
  else
    read -r -p "${prompt}: " val
  fi
  printf '%s' "$val"
}

is_port() { [[ "${1:-}" =~ ^[0-9]+$ ]] && (( 1 <= 10#${1} && 10#${1} <= 65535 )); }

gen_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

need_cmd docker
docker compose version >/dev/null 2>&1 || err "docker compose (v2 plugin) is required"

[[ -f docker-compose.yml ]] || err "Run from project root (docker-compose.yml not found)"
[[ -f "${NGINX_DIST}" ]] || err "Missing ${NGINX_DIST} in project root"

echo "=== AmneziaWG setup ==="

image_tag="$(ask "GHCR image tag (dev/latest/X.Y.Z)" "dev")"

domain="$(ask "Public domain for UI (must resolve to this host)" "")"
[[ -n "$domain" ]] || err "DOMAIN is required"

email="$(ask "Certbot email (for Let's Encrypt)" "")"
[[ -n "$email" ]] || err "CERTBOT_EMAIL is required"

wg_port="$(ask "VPN UDP port" "51820")"
is_port "$wg_port" || err "WG_PORT must be 1..65535"

wg_iface="$(ask "Interface name inside container" "wg0")"
wg_subnet="$(ask "VPN subnet (IPv4 /24 recommended)" "10.8.0.0/24")"
wg_address="$(ask "Server VPN address" "10.8.0.1/24")"

endpoint_host="$(ask "Public endpoint host for client configs (domain or IP; empty to skip)" "")"
wg_endpoint=""
if [[ -n "$endpoint_host" ]]; then
  wg_endpoint="${endpoint_host}:${wg_port}"
fi

admin_token="$(ask "Admin token (leave empty to auto-generate)" "")"
if [[ -z "$admin_token" ]]; then
  admin_token="$(gen_token)"
fi

# Persistent dirs
mkdir -p "${DATA_DIR}/server" "${DATA_DIR}/letsencrypt" "${DATA_DIR}/certbot/www"

# Render nginx.conf from nginx.conf.dist
# We never modify nginx.conf.dist. We create/update nginx.conf in root.
if [[ -f "${NGINX_CONF}" ]]; then
  overwrite="$(ask "${NGINX_CONF} already exists. Overwrite it with domain '${domain}'? (yes/no)" "no")"
  if [[ "$overwrite" != "yes" ]]; then
    echo "Keeping existing ${NGINX_CONF}"
  else
    tmp="$(mktemp)"
    sed "s/__DOMAIN__/${domain}/g" "${NGINX_DIST}" > "${tmp}"
    install -m 0644 "${tmp}" "${NGINX_CONF}"
    rm -f "${tmp}"
    echo "Rendered ${NGINX_CONF} from ${NGINX_DIST}"
  fi
else
  tmp="$(mktemp)"
  sed "s/__DOMAIN__/${domain}/g" "${NGINX_DIST}" > "${tmp}"
  install -m 0644 "${tmp}" "${NGINX_CONF}"
  rm -f "${tmp}"
  echo "Rendered ${NGINX_CONF} from ${NGINX_DIST}"
fi

# Write .env
if [[ -f "${ENV_FILE}" ]]; then
  overwrite_env="$(ask "${ENV_FILE} already exists. Overwrite it? (yes/no)" "no")"
  if [[ "$overwrite_env" != "yes" ]]; then
    echo "Keeping existing ${ENV_FILE}"
  else
    cat > "${ENV_FILE}" <<EOF
IMAGE_TAG=${image_tag}
DOMAIN=${domain}
CERTBOT_EMAIL=${email}

WG_IFACE=${wg_iface}
WG_PORT=${wg_port}
WG_ADDRESS=${wg_address}
WG_SUBNET=${wg_subnet}
WG_ENDPOINT=${wg_endpoint}

ADMIN_TOKEN=${admin_token}
EOF
    echo "Written ${ENV_FILE}"
  fi
else
  cat > "${ENV_FILE}" <<EOF
IMAGE_TAG=${image_tag}
DOMAIN=${domain}
CERTBOT_EMAIL=${email}

WG_IFACE=${wg_iface}
WG_PORT=${wg_port}
WG_ADDRESS=${wg_address}
WG_SUBNET=${wg_subnet}
WG_ENDPOINT=${wg_endpoint}

ADMIN_TOKEN=${admin_token}
EOF
  echo "Written ${ENV_FILE}"
fi

echo
echo "Next:"
echo "  1) docker compose pull"
echo "  2) docker compose up -d"
echo
echo "First-time certificate issuance (HTTP-01 uses port 80):"
echo "  docker compose run --rm certbot certonly \\"
echo "    --webroot -w /var/www/certbot \\"
echo "    -d ${domain} \\"
echo "    --email ${email} --agree-tos --no-eff-email"
echo
echo "Then reload UI to pick up certs:"
echo "  docker compose restart ui"
echo
echo "Admin token (store securely): ${admin_token}"
