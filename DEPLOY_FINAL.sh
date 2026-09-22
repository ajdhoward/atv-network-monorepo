#!/bin/bash
set -e
TOKEN_FILE="/home/adam/Downloads/cf-token.txt"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "ERROR: $TOKEN_FILE not found"
  echo "Create it in Notepad with just your token on line 1"
  exit 1
fi

echo "=== ATV Network Final Deploy - ajdhoward ==="
echo "Token file: $TOKEN_FILE (size: $(wc -c < "$TOKEN_FILE") bytes)"

# Tools
corepack enable 2>/dev/null || true
corepack prepare pnpm@9.1.0 --activate 2>/dev/null || npm i -g pnpm
command -v gh >/dev/null || { echo "Install gh: sudo dnf install gh"; exit 1; }

# Auth checks
echo "Checking wrangler OAuth..."
npx wrangler whoami || npx wrangler login

echo "Checking gh auth..."
gh auth status || gh auth login

# Clean old .wrangler
rm -rf .wrangler

# Install + typecheck + deploy edge (uses OAuth, no token needed)
pnpm install
pnpm typecheck
npx wrangler deploy --config wrangler.toml

# Set GitHub secrets FROM YOUR NOTEPAD FILE
echo "Setting GitHub secrets from $TOKEN_FILE ..."
gh secret set CF_API_TOKEN --repo ajdhoward/atv-network-monorepo < "$TOKEN_FILE"
gh secret set CLOUDFLARE_API_TOKEN --repo ajdhoward/atv-network-monorepo < "$TOKEN_FILE"
gh auth token | gh secret set GH_PRIVATE_TOKEN --repo ajdhoward/atv-network-monorepo

gh secret list --repo ajdhoward/atv-network-monorepo

# Git push
if ! gh repo view ajdhoward/atv-network-monorepo &>/dev/null; then
  gh repo create atv-network-monorepo --public --source=. --remote=origin --push --description "ATV Network - atv.acidwurx.org"
else
  git remote remove origin 2>/dev/null || true
  git remote add origin https://github.com/ajdhoward/atv-network-monorepo.git
  git branch -M main
  git add .
  git commit -m "feat: final AcidWurx deploy - KV live, secrets from cf-token.txt" || true
  git push -u origin main
fi

# Ensure private backup exists
gh repo view ajdhoward/atv-network-private-backup &>/dev/null || gh repo create atv-network-private-backup --private

echo ""
echo "✅ DONE"
echo "Watch deploy: gh run watch --repo ajdhoward/atv-network-monorepo"
echo "Live URL: https://atv.acidwurx.org/api/guide"
echo ""
echo "You can now safely delete $TOKEN_FILE if you want: rm $TOKEN_FILE"
