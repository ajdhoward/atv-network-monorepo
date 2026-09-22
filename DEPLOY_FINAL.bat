@echo off
set TOKEN_FILE=C:\Users\adam\Downloads\cf-token.txt
if exist "%TOKEN_FILE%" (
  echo Token file found
) else (
  set TOKEN_FILE=/home/adam/Downloads/cf-token.txt
)

echo === ATV Network Final Deploy ===
call npx wrangler whoami || call npx wrangler login
call pnpm install
call pnpm typecheck
call npx wrangler deploy --config wrangler.toml

gh secret set CF_API_TOKEN --repo ajdhoward/atv-network-monorepo < "%TOKEN_FILE%"
gh secret set CLOUDFLARE_API_TOKEN --repo ajdhoward/atv-network-monorepo < "%TOKEN_FILE%"
gh auth token | gh secret set GH_PRIVATE_TOKEN --repo ajdhoward/atv-network-monorepo

git remote add origin https://github.com/ajdhoward/atv-network-monorepo.git 2>nul
git branch -M main
git add .
git commit -m "feat: final deploy"
git push -u origin main
