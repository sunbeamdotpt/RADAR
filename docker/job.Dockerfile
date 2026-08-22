# RADAR inventory job — one-shot container (Kubernetes Job / wfe-style).
# Clones the git base, checks upstreams, writes the report to the store, exits.
FROM denoland/deno:2.9.5

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --chown=deno:deno deno.json deno.lock ./
COPY --chown=deno:deno src ./src
COPY --chown=deno:deno db ./db
COPY --chown=deno:deno seed ./seed
RUN mkdir -p /app/data && chown deno:deno /app/data

USER deno
RUN deno cache --frozen src/job/main.ts

# --allow-write: git base clone (temp dir) + JSON store/mirror. --allow-run=git: clone.
CMD ["deno", "run", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "--allow-run=git", "src/job/main.ts"]
