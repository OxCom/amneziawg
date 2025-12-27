#!/usr/bin/env bash
set -euo pipefail

ENV_FILE=".env"

ask() {
  local var="$1"; local prompt="$2"; local def="${3:-}"
  local val=""
  if [[ -n "${def}" ]]; then
    read -r -p "${prompt} [${def}]: " val
    val="${val:-$def}"
  else
    read -r -p "${prompt}: " val
  fi
  printf '%s' "$val"
}

if [[ -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} already exists. Remove it first if you want to re-run setup."
  exit 1
fi

amz_go_ref="$(ask AMNEZIAWG_GO_REF 'amneziawg-go ref (tag/branch/commit)' 'master')"
amz_tools_ref="$(ask AMNEZIAWG_TOOLS_REF 'amneziawg-tools ref (tag/branch/commit)' 'master')"

wg_port="$(ask WG_PORT 'VPN UDP port' '51820')"
wg_subnet="$(ask WG_SUBNET 'VPN subnet CIDR (IPv4 /24 required for allocator right now)' '10.8.0.0/24')"
wg_server_ip="$(ask WG_SERVER_IP 'Server VPN IP (inside subnet)' '10.8.0.1')"

wg_endpoint_host="$(ask WG_ENDPOINT_HOST 'Public endpoint host (domain or IP) used in client configs' '')"
if [[ -z "${wg_endpoint_host}" ]]; then
  wg_endpoint=""
else
  wg_endpoint="${wg_endpoint_host}:${wg_port}"
fi

admin_token="$(ask ADMIN_TOKEN 'Admin token (leave empty to auto-generate)' '')"
if [[ -z "${admin_token}" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    admin_token="$(openssl rand -base64 32 | tr -d '\n')"
  else
    echo "ERROR: openssl not found and ADMIN_TOKEN not provided."
    exit 1
  fi
fi

cat > "${ENV_FILE}" <<EOF
AMNEZIAWG_GO_REF=${amz_go_ref}
AMNEZIAWG_TOOLS_REF=${amz_tools_ref}

WG_IFACE=wg0
WG_PORT=${wg_port}
WG_SUBNET=${wg_subnet}
WG_ADDRESS=${wg_server_ip}/24
WG_ENDPOINT=${wg_endpoint}

ADMIN_TOKEN=${admin_token}
EOF

echo "Written ${ENV_FILE}"
echo "Next:"
echo "  docker compose up -d --build"
