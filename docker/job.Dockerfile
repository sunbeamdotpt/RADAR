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
RUN deno cache --frozen src/job/main.ts \
  && deno cache --frozen src/assess/main.ts

ENV OTEL_DENO=true
ENV OTEL_SERVICE_NAME=radar

# ENTRYPOINT (not CMD): the base image's own ENTRYPOINT is ["deno"], so a plain
# CMD would be *replaced* by any args passed to `docker run image --bootstrap`,
# producing `deno --bootstrap`. With ENTRYPOINT, extra args land on the script.
# --allow-write: git base clone (temp dir) + JSON store/mirror. --allow-run=git: clone.
ENTRYPOINT ["deno", "run", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "--allow-run=git", "src/job/main.ts"]
