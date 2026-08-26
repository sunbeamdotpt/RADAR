# RADAR API server — read-only REST endpoint over the inventory store.
FROM denoland/deno:2.9.5

WORKDIR /app

COPY --chown=deno:deno deno.json deno.lock ./
COPY --chown=deno:deno src ./src
COPY --chown=deno:deno db ./db
COPY --chown=deno:deno seed ./seed

USER deno
RUN deno cache --frozen src/server/main.ts

EXPOSE 8080
ENV OTEL_DENO=true
ENV OTEL_SERVICE_NAME=radar
# --allow-read: seed JSON store + migrations. --allow-net: listen + postgres.
CMD ["deno", "run", "--allow-env", "--allow-net", "--allow-read", "src/server/main.ts"]
