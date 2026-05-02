#!/usr/bin/env bash
# Inject API_URL into the Angular production environment file at build time.
# Used by Render preview deployments where the API URL is dynamic.
# If API_URL is not set, the file is left unchanged (keeps the hardcoded default).

set -euo pipefail

if [ -z "${API_URL:-}" ]; then
  echo "[set-api-url] API_URL not set, using default."
  exit 0
fi

ENV_FILE="apps/web/src/environments/environment.prod.ts"

cat > "$ENV_FILE" <<EOF
export const environment = {
  production: true,
  apiUrl: '${API_URL}/api',
  sentryDsn: '',
};
EOF

echo "[set-api-url] Wrote apiUrl=${API_URL}/api to ${ENV_FILE}"
