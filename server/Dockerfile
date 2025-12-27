# syntax=docker/dockerfile:1.7

# Build stage (multi-arch)
FROM --platform=$BUILDPLATFORM golang:1.25.5-bookworm AS build

ARG TARGETARCH
ARG AMNEZIAWG_GO_REF=master
ARG AMNEZIAWG_TOOLS_REF=master

ENV DEBIAN_FRONTEND=noninteractive
ENV GOTOOLCHAIN=local
# enforce reproducible deps (fail build if go.mod/go.sum mismatch)
ENV GOFLAGS="-mod=readonly"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential pkg-config make \
  && rm -rf /var/lib/apt/lists/*

# ---------- amneziawg-go ----------
RUN git clone https://github.com/amnezia-vpn/amneziawg-go.git /src/amneziawg-go \
 && cd /src/amneziawg-go \
 && git checkout "${AMNEZIAWG_GO_REF}" \
 && go mod download \
 && go mod verify \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/usr/local/bin/amneziawg-go .

# ---------- amneziawg-tools (awg/awg-quick) ----------
RUN git clone https://github.com/amnezia-vpn/amneziawg-tools.git /src/amneziawg-tools \
 && cd /src/amneziawg-tools \
 && git checkout "${AMNEZIAWG_TOOLS_REF}" \
 && make -C src \
 && make -C src install DESTDIR=/out PREFIX=/usr

# ---------- awg-manager ----------
WORKDIR /src/manager
COPY server/src /src/manager
RUN go mod download \
 && go mod verify \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/usr/local/bin/awg-manager ./cmd/awg-manager

# Runtime stage: Ubuntu 24.04
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates bash iproute2 iptables procps \
  && rm -rf /var/lib/apt/lists/*

# Copy all built artifacts (binaries + awg tools + etc files)
COPY --from=build /out/ /

COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data"]

EXPOSE 51820/udp
EXPOSE 8080/tcp

ENTRYPOINT ["/entrypoint.sh"]
