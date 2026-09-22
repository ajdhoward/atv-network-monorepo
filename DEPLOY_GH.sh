#!/bin/bash
set -e
echo "=== ATV Network - GH CLI Deploy for ajdhoward ==="

# 1. Ensure tools
if ! command -v gh &> /dev/null; then
  echo "Installing gh..."
  # Debian/Ubuntu
  sudo apt update && sudo apt install gh -y || brew install gh
fi
corepack enable
corepack prepare pnpm@9.1.0 --activate || npm i -g pnpm

# 2. Auth
gh auth login -p https -w
npx wrangler login

# 3. Install + deploy edge
pnpm install
pnpm typecheck
npx wrangler deploy --config wrangler.toml

# 4. GitHub repos via gh
if ! gh repo view ajdhoward/atv-network-monorepo &>/dev/null; then
  gh repo create atv-network-monorepo --public --source=. --remote=origin --push
else
  git remote add origin https://github.com/ajdhoward/atv-network-monorepo.git 2>/dev/null || true
  git branch -M main
  git add .
  git commit -m "feat: atv core with live KV IDs" || true
  git push -u origin main
fi

# private backup repo
if ! gh repo view ajdhoward/atv-network-private-backup &>/dev/null; then
  gh repo create atv-network-private-backup --private --description "ATV private config + logs backup"
fi

# 5. Secrets for CI/CD
echo "Setting GitHub Actions secrets..."
read -p "Paste Cloudflare API Token: " CF_TOKEN
gh secret set CF_API_TOKEN --body "$CF_TOKEN" --repo ajdhoward/atv-network-monorepo
gh secret set GH_PRIVATE_TOKEN --body "$(gh auth token)" --repo ajdhoward/atv-network-monorepo

echo "Done! Push will trigger .github/workflows/deploy-main.yml"
