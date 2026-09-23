#!/bin/bash
ZONE=${ATV_DOMAIN:-acidwurx.org}
for h in api.atv.$ZONE atv.$ZONE remote.atv.$ZONE; do echo -n "$h: "; curl -s "https://cloudflare-dns.com/dns-query?name=$h&type=AAAA" -H "accept: application/dns-json" | grep -q "100::" && echo "AAAA 100:: OK" || echo "FAIL"; done
for h in admin.atv.$ZONE tv.atv.$ZONE; do echo -n "$h: "; curl -s "https://cloudflare-dns.com/dns-query?name=$h&type=CNAME" -H "accept: application/dns-json" | grep -q "pages.dev" && echo "CNAME pages.dev OK" || echo "FAIL"; done
