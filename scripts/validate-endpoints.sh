#!/bin/bash
ZONE=${ATV_DOMAIN:-acidwurx.org}
TOKEN=${ATV_ADMIN_TOKEN:-}
echo "Testing $ZONE..."
code1=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "https://api.atv.$ZONE/api/health")
code2=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "https://atv.$ZONE/api/health")
code3=$(curl -s -o /dev/null -w "%{http_code}" "https://atv.$ZONE/api/health")
code4=$(curl -s -o /dev/null -w "%{http_code}" "https://admin.atv.$ZONE")
code5=$(curl -s -o /dev/null -w "%{http_code}" "https://tv.atv.$ZONE")
code6=$(curl -s -o /dev/null -w "%{http_code}" "https://remote.atv.$ZONE/api/health")
code7=$(curl -s -o /dev/null -w "%{http_code}" "https://remote.atv.$ZONE")
code8=$(curl -s -o /dev/null -w "%{http_code}" -H "Upgrade: websocket" -H "Connection: Upgrade" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" -H "Sec-WebSocket-Version: 13" "https://remote.atv.$ZONE/ws/test-room")
echo "$code1 $code2 $code3 $code4 $code5 $code6 $code7 $code8"
echo "Expected 200 200 401 200 200 200 404 101"
