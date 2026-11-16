#!/bin/bash
# 在服务器上执行：把 release.tgz 解包成新版本并重建容器。由 tools/deploy-hk.ps1 调用。
set -euo pipefail
D=/opt/apps/thin-muscle-workout
cd "$D"
[ -f app.env ] || { echo "缺少 $D/app.env（机密环境变量），停止部署" >&2; exit 1; }
rm -rf src.new && mkdir src.new
tar -xzf release.tgz -C src.new
[ -f src.new/Dockerfile ] || { echo "release.tgz 内容不完整，停止部署" >&2; exit 1; }
rm -rf src.prev
[ -d src ] && mv src src.prev
mv src.new src
cd src
docker compose -p thin-muscle -f deploy/hk/compose.yaml up -d --build --remove-orphans
docker image prune -f >/dev/null
for i in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' thin-muscle-app 2>/dev/null || echo none)
  [ "$s" = healthy ] && break
  sleep 2
done
docker ps --filter name=thin-muscle-app --format '{{.Names}} {{.Status}} {{.Ports}}'
[ "$s" = healthy ] || { echo "容器未进入 healthy，最近日志：" >&2; docker logs --tail 50 thin-muscle-app >&2; exit 1; }
echo "部署完成：http://154.222.23.16/"
