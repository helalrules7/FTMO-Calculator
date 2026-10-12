#!/usr/bin/env bash
# Build a clean dist/ (stamped service-worker version) and rsync it to your server over SSH.
# Usage: ./deploy/deploy.sh            (reads deploy/.env)
#        ./deploy/deploy.sh --dry-run  (show what would change)
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f deploy/.env ]] || { echo "Missing deploy/.env — copy deploy/.env.example and fill it in."; exit 1; }
set -a; source deploy/.env; set +a
: "${DEPLOY_HOST:?}" "${DEPLOY_USER:?}" "${DEPLOY_PATH:?}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
KEY="${DEPLOY_KEY/#\~/$HOME}"

echo "→ Running tests"
npm test --silent

echo "→ Building dist/"
rm -rf dist && mkdir -p dist
rsync -a index.html manifest.webmanifest sw.js src fonts icons dist/
rm -rf dist/src/**/*.test.js 2>/dev/null || true
VERSION="ftmo-risk-$(date +%Y%m%d%H%M%S)"
sed -i.bak "s/const VERSION = '[^']*'/const VERSION = '${VERSION}'/" dist/sw.js && rm dist/sw.js.bak
echo "  service worker version: ${VERSION}"

SSH="ssh -p ${DEPLOY_PORT} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new ${KEY:+-i $KEY}"
echo "→ Uploading to ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}"
$SSH "${DEPLOY_USER}@${DEPLOY_HOST}" "mkdir -p '${DEPLOY_PATH}'"
rsync -az --delete --checksum ${1:-} -e "$SSH" dist/ "${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PATH}/"
if [[ -n "${DEPLOY_OWNER:-}" && -z "${1:-}" ]]; then
  $SSH "${DEPLOY_USER}@${DEPLOY_HOST}" "chown -R '${DEPLOY_OWNER}' '${DEPLOY_PATH}' && find '${DEPLOY_PATH}' -type d -exec chmod 755 {} + && find '${DEPLOY_PATH}' -type f -exec chmod 644 {} +"
fi
echo "✓ Deployed ${VERSION}${DOMAIN:+ → https://${DOMAIN}}"
