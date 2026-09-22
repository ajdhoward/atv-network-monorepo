# ATV Network - FINAL - ajdhoward / AcidWurx

KV IDs injected:
- ATV_CACHE = 7e635f2e4ac44488a336f9d509b63061
- ATV_CONFIG = a59048e76fbd47c185bd4fc62fc3111a

## One-Command Deploy from Downloads folder

You already created: /home/adam/Downloads/cf-token.txt
File should contain ONLY the token on line 1.

### Linux (your current)
```bash
cd /home/adam/Downloads
unzip atv-network-monorepo-final.zip
cd atv-network-monorepo-final
chmod +x DEPLOY_FINAL.sh
./DEPLOY_FINAL.sh
```

That's it. The script will:
1. wrangler whoami (uses your existing OAuth)
2. pnpm install + typecheck
3. wrangler deploy -> atv.acidwurx.org
4. gh secret set < /home/adam/Downloads/cf-token.txt
5. git push -> triggers Actions
