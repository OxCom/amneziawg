#!/usr/bin/env bash
set -euo pipefail

: "${WG_IFACE:=wg0}"
: "${WG_PORT:=51820}"
: "${WG_ADDRESS:=10.8.0.1/24}"
: "${WG_SUBNET:=10.8.0.0/24}"
: "${WG_POSTROUTING_IFACE:=eth0}"
: "${API_LISTEN:=0.0.0.0:8080}"

if [[ ! -c /dev/net/tun ]]; then
  echo "ERROR: /dev/net/tun is not available. Run with --device=/dev/net/tun and cap NET_ADMIN."
  exit 1
fi

mkdir -p /data

sysctl -w net.ipv4.ip_forward=1 >/dev/null || true

if ! ip link show "${WG_IFACE}" >/dev/null 2>&1; then
  /usr/local/bin/amneziawg-go "${WG_IFACE}" &
  sleep 0.5
fi

if ! ip addr show dev "${WG_IFACE}" | grep -q "${WG_ADDRESS%/*}"; then
  ip addr add "${WG_ADDRESS}" dev "${WG_IFACE}" || true
fi

ip link set up dev "${WG_IFACE}"

iptables -t nat -C POSTROUTING -s "${WG_SUBNET}" -o "${WG_POSTROUTING_IFACE}" -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -s "${WG_SUBNET}" -o "${WG_POSTROUTING_IFACE}" -j MASQUERADE

exec /usr/local/bin/awg-manager \
  --data-dir /data \
  --iface "${WG_IFACE}" \
  --port "${WG_PORT}" \
  --listen "${API_LISTEN}"
