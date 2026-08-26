# RADAR dry-run preview job — one-shot container (Kubernetes Job / wfe-style).
# Clones the git base, mutates likely-safe drifted Helm charts to their latest
# versions, runs `kustomize build`, then `kubectl apply --dry-run=server`.
FROM denoland/deno:2.9.5

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

# Install kubectl, kustomize, and helm. Versions are pinned to match the
# current local toolchain; bump them together with the host CI image.
ARG KUBECTL_VERSION=v1.36.3
ARG KUSTOMIZE_VERSION=v5.8.1
RUN curl -fsSL -o /usr/local/bin/kubectl \
    "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
  && chmod +x /usr/local/bin/kubectl
RUN curl -fsSL "https://raw.githubusercontent.com/kubernetes-sigs/kustomize/kustomize/${KUSTOMIZE_VERSION}/hack/install_kustomize.sh" \
    | bash -s -- ${KUSTOMIZE_VERSION#v} /usr/local/bin
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 \
    | bash

WORKDIR /app

COPY --chown=deno:deno deno.json deno.lock ./
COPY --chown=deno:deno src ./src
COPY --chown=deno:deno db ./db
COPY --chown=deno:deno seed ./seed
RUN mkdir -p /app/data && chown deno:deno /app/data

USER deno
RUN deno cache --frozen src/dryrun/main.ts

# --allow-write: git base clone (temp dir) + JSON store/mirror.
# --allow-run=git,kubectl,kustomize,helm: render manifests and dry-run them.
ENTRYPOINT ["deno", "run", "--allow-env", "--allow-net", "--allow-read", "--allow-write", "--allow-run=git,kubectl,kustomize,helm", "src/dryrun/main.ts"]
