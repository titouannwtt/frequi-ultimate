# frequi-gateway image: a static musl binary on `scratch`, running as a non-root user.
#
# Build, from the gateway/ directory:
#   docker build -f packaging/Dockerfile -t frequi-gateway .
#
# Limits of the container mode (see docs/UPGRADE.en.md):
#   - bots are found by scanning /proc, so the container needs `--pid=host` to see them; without
#     it the gateway starts with no bot;
#   - it reads the bot configs and databases: mount them at the SAME paths as on the host and run with
#     the bots' uid. A read-only mount (:ro) is a REAL read-only file system here, and a WAL database
#     can then only be opened while its bot runs (the -wal and -shm files exist): a bot that stopped
#     cleanly leaves a database without -shm, which cannot be opened read-only ("unable to open
#     database file"). Mount the data directory read-write if you need those; the gateway itself
#     only ever opens the databases with SQLite mode=ro:
#       docker run --pid=host --user "$(id -u):$(id -g)" -v "$HOME/freqtrade:$HOME/freqtrade:ro" ...
#   - state is kept in /data: mount a volume there. The configuration is optional (defaults):
#       -v ./config:/config:ro  ... run --config /config/config.toml --secrets /config/secrets.toml
FROM rust:1-alpine AS build
RUN apk add --no-cache build-base ca-certificates
WORKDIR /src
COPY . .
ENV RUSTFLAGS="-C target-feature=+crt-static"
RUN cargo build --release --locked -p frequi-gateway \
    && mkdir -p /out/data \
    && cp target/release/frequi-gateway /out/frequi-gateway

FROM scratch
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/frequi-gateway /frequi-gateway
# 65532 is the conventional "nonroot" id of distroless images.
COPY --from=build --chown=65532:65532 /out/data /data
USER 65532:65532
ENV HOME=/data \
    FG_STORAGE__DATA_DIR=/data \
    FG_SERVER__LISTEN=0.0.0.0:9399
EXPOSE 9399
VOLUME ["/data"]
ENTRYPOINT ["/frequi-gateway"]
CMD ["run"]
