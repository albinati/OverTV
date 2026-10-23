#!/usr/bin/env bash
# Empacota ./app, assina com os certificados Samsung em ./certs e instala na TV.
# Uso: ./deploy.sh            (TV em Developer Mode, mesmo Wi-Fi)
#      TV_IP=192.168.1.231 ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && . ./.env            # TV_IP e CERT_PASS (não versionado)
TV_IP="${TV_IP:?defina TV_IP no .env ou no ambiente}"
PASS="${CERT_PASS:?defina CERT_PASS no .env (senha dos .p12)}"
APP_ID=IptvPlyr01.IPTVPlayer

# 1. Assina (node-forge, sem Tizen Studio)
[ -d tools/tizen-cli/node_modules ] || (cd tools/tizen-cli && npm install --silent --no-audit --no-fund)
rm -f app/*.wgt app/.manifest.tmp
(cd app && node ../tools/tizen-cli/cli.js build . -t wgt -o ../IPTVPlayer.wgt \
  --author ../certs/samsung/author.p12 --authorPwd "$PASS" \
  --distributor ../certs/samsung/distributor.p12 --distributorPwd "$PASS")

# 2. Envia e instala pelo sdb (imagem Docker x86 com o Tizen CLI oficial)
docker image inspect tizen-cli >/dev/null 2>&1 || docker build --platform linux/amd64 -t tizen-cli tools/tizen-docker
rm -rf .deploy && mkdir .deploy && cp IPTVPlayer.wgt certs/samsung/device-profile.xml .deploy/ && chmod -R 777 .deploy
docker run --rm --platform linux/amd64 --network host -v "$PWD/.deploy:/d" tizen-cli bash -c "
  sdb kill-server >/dev/null 2>&1; sdb connect $TV_IP:26101 >/dev/null; sleep 2
  sdb devices | grep -q "$TV_IP" || { echo 'TV não conectou via sdb (Developer Mode ligado? IP certo?)'; exit 1; }
  sdb push /d/device-profile.xml /home/owner/share/tmp/sdk_tools/ 2>&1 | grep -v WARNING
  sdb push /d/IPTVPlayer.wgt /home/owner/share/tmp/sdk_tools/tmp/app.wgt 2>&1 | grep -v WARNING
  sdb shell 0 vd_appinstall $APP_ID /home/owner/share/tmp/sdk_tools/tmp/app.wgt 2>&1 | grep -E 'fail|reason|completed'
  sdb shell 0 was_execute $APP_ID 2>&1 | grep -E 'launched|fail'"
rm -rf .deploy
