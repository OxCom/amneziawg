# Build stage: Go 1.25.x
FROM golang:1.25.5-bookworm AS build
# tag 1.25.5-bookworm есть в официальных образах golang :contentReference[oaicite:2]{index=2}

ARG TARGETARCH
ARG AMNEZIAWG_GO_REF=master
ARG AMNEZIAWG_TOOLS_REF=master

ENV DEBIAN_FRONTEND=noninteractive
ENV GOTOOLCHAIN=local
# Запрещаем "подправлять" go.mod/go.sum во время сборки:
ENV GOFLAGS="-mod=readonly"

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git build-essential pkg-config make \
    && rm -rf /var/lib/apt/lists/*

# Build amneziawg-go (в корне один main-пакет)
RUN git clone https://github.com/amnezia-vpn/amneziawg-go.git /src/amneziawg-go \
 && cd /src/amneziawg-go \
 && git checkout "${AMNEZIAWG_GO_REF}" \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/amneziawg-go .

# Build amneziawg-tools (awg/awg-quick)
RUN git clone https://github.com/amnezia-vpn/amneziawg-tools.git /src/amneziawg-tools \
 && cd /src/amneziawg-tools \
 && git checkout "${AMNEZIAWG_TOOLS_REF}" \
 && cd src \
 && make \
 && make install PREFIX=/out/usr

# Build manager
COPY server/src /src/manager
RUN cd /src/manager \
 && CGO_ENABLED=0 GOOS=linux GOARCH="${TARGETARCH}" \
    go build -trimpath -ldflags="-s -w" -o /out/awg-manager ./cmd/awg-manager


# Runtime stage: Ubuntu 24.04 (как вы требовали)
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates bash iproute2 iptables \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/amneziawg-go /usr/local/bin/amneziawg-go
COPY --from=build /out/usr/ /usr/
COPY --from=build /out/awg-manager /usr/local/bin/awg-manager

COPY server/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

VOLUME ["/data"]

EXPOSE 51820/udp
EXPOSE 8080/tcp

ENTRYPOINT ["/entrypoint.sh"]
