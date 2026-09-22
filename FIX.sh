#!/bin/bash
# Run these in your current atv-network-monorepo folder

# 1. Fix pnpm missing
corepack enable
corepack prepare pnpm@9.1.0 --activate
# fallback: npm i -g pnpm

# 2. Clean bad commit
rm -rf .wrangler
echo "node_modules/" >> .gitignore
echo ".wrangler/" >> .gitignore
echo "dist/" >> .gitignore

# 3. Update wrangler.toml IDs (already done in v2 zip)
cat wrangler.toml

# 4. Install and build
pnpm install
pnpm typecheck

# 5. Deploy core
npx wrangler deploy --config wrangler.toml

# 6. Fix git remote - REPLACE WITH YOUR PRIVATE REPO
git remote remove origin 2>/dev/null || true
git remote add origin git@github.com:atv-admin-user/atv-network-monorepo.git
git branch -M main
git add . && git commit -m "fix: inject live KV IDs and gitignore"
git push -u origin main
