FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea

# No host home, credential, npmrc or Docker configuration enters the build context.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ca-certificates \
    && sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 install -y --no-install-recommends \
    ca-certificates bash git git-lfs openssh-client gh curl wget jq ripgrep fd-find \
    zip unzip xz-utils tar procps file less patch diffutils rsync sqlite3 \
    build-essential cmake ninja-build pkg-config gdb \
    python3 python3-pip python3-venv pipx \
    golang-go rustc cargo openjdk-21-jdk-headless maven \
    && rm -rf /var/lib/apt/lists/*
RUN npm install --global --ignore-scripts pnpm@12.15.0 typescript@7.0.2 \
    && npm install --global wrangler@4.154.0 \
    && npm cache clean --force
RUN mkdir -p /opt/bridge/local /opt/bridge/container /home/developer /workspace /opt/private \
    && chown 1000:1000 /home/developer \
    && dpkg-query -W > /opt/bridge/os-packages.txt \
    && npm list --global --depth=0 --json > /opt/bridge/npm-packages.json
COPY local/ /opt/bridge/local/
COPY container/runner.mjs container/file-worker.mjs /opt/bridge/container/
RUN chmod -R a-w /opt/bridge && chmod 700 /opt/private
ENV HOME=/home/developer LANG=C.UTF-8 PYTHONUNBUFFERED=1 \
    GOTOOLCHAIN=local GOCACHE=/home/developer/.cache/go-build \
    GOPATH=/home/developer/go CARGO_HOME=/home/developer/.cargo \
    WRANGLER_SEND_METRICS=false NO_COLOR=1
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/bridge/container/runner.mjs"]
