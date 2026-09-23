#!/bin/bash
set -e
echo "Full validation - must be 200,200,401,200,200,200,404,101"
bash scripts/validate-dns.sh
bash scripts/validate-endpoints.sh
