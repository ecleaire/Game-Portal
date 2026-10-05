#!/usr/bin/env bash
set -euo pipefail

# Linux cloud/CI setup. No production services or credentials are used.
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
node --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'
npm ci
npx --no-install playwright install --with-deps chromium
echo 'Cloud dependencies are ready. Run npm test, npm run build, then npm run test:browser.'
