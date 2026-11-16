# AI 协作约定

本文件是本仓库供 Codex、Claude Code、Gemini CLI、Cursor 等 AI 编码工具共用的项目指引。开始处理仓库任务前先阅读本文件和 `PROJECT.md`。

## 数据库与基础设施（2026-11-16 起在香港服务器）

- 本项目：PostgreSQL 16 `154.222.23.16:35432`，库 `thinmuscle`，账号 `thin`（密码已改，不再是 thin）。连接串在被忽略的根目录 `.env` 的 `DATABASE_URL`，docker-compose.yml 的 app 通过它连接服务器。
- app 已部署到服务器正式运行（见下文“正式环境”），通过 docker 内网连库；根目录 `.env` 的 `DATABASE_URL`（公网 35432）只给本地调试用。`docker-compose.yml` 的 `db` 服务放进了 `local-db` profile，默认不启动；**不要用 `--profile local-db` 启动本地库**，本地 `thin-muscle-workout-db-1` 和卷 `thin-muscle-workout_dbdata` 是停用备份，禁止 `docker compose down -v`。

- 服务器：`154.222.23.16`（香港，Ubuntu 24.04）。本机可直接 `ssh hk`（已配密钥）。编排目录 `/opt/devstack`，容器 devstack-mysql / devstack-redis / devstack-postgres / devstack-minio。
- 凭据只在 `D:\projects\_server-credentials.md`（服务器副本 `/root/devstack-credentials.md`）。**禁止把任何密码抄进代码、文档、日志、报告或聊天**；项目连接配置已写在被忽略的本地配置文件里（见上）。
- 本地旧数据库容器已停止（restart=no），只作为备份保留：**不要启动、删除、重建，也不要用 compose 拉起本地 db 服务**。
- 本机到服务器往返约 100ms（Clash 已对 154.222.23.16 走 DIRECT）。批量数据操作合并成少量 SQL / 单事务，避免逐行往返。
- 迁移时改过的文件同目录留有原件 `*.bak-before-hk-20261116`，可据此回滚；回滚前先问用户。
- 全部项目的对照表见 `D:\projects\AGENTS.md`。

## 正式环境（2026-11-16 起在香港服务器，强制）

- 访问地址：**http://154.222.23.16/**（手机、电脑都用这个；暂无域名，所以只有 HTTP）。本机 `http://localhost:3001` 已停用，用户不再在本地运行。
- 服务器容器 `thin-muscle-app`（compose 项目 thin-muscle，restart=unless-stopped，内存上限 384M，NODE_ENV=production），代码在服务器 `/opt/apps/thin-muscle-workout/src`，上一版在 `src.prev`。通过 docker 内网 `devstack_default` 连接 `devstack-postgres:5432/thinmuscle`，不走公网端口。
- 机密环境变量（DATABASE_URL、COACH_INVITE_ENCRYPTION_KEY、AI_COACH_API_KEY 等）在服务器 `/opt/apps/thin-muscle-workout/app.env`（chmod 600，不进仓库）；改了要重新部署才生效。私有媒体在卷 `thin-muscle-private-media`。
- **重新部署**：本机项目根目录运行 `powershell -ExecutionPolicy Bypass -File tools/deploy-hk.ps1`（打包代码→上传→服务器重建容器→等 healthy→公网检查），约几分钟。编排文件 `deploy/hk/compose.yaml`，服务器脚本 `deploy/hk/server-deploy.sh`。只在用户要求上线/发布时运行；本地改完代码默认不自动部署。
- 回滚：`ssh hk` 后 `cd /opt/apps/thin-muscle-workout && rm -rf src && mv src.prev src && cd src && docker compose -p thin-muscle -f deploy/hk/compose.yaml up -d --build`。
- 看日志：`ssh hk docker logs --tail 200 -f thin-muscle-app`；状态：`ssh hk docker ps --filter name=thin-muscle-app`。
- 验证线上时只读检查或用不影响训练记录的操作（如登录/退出）；不要为测试改写用户的训练记录，不要伪称部署或验证成功。
- 本地 `start.bat` / `docker compose up` 只在用户明确要求本地调试时使用（本地 app 容器 `thin-muscle-workout-app-1` 已停止、restart=no）；不要另起临时 Web 服务器或改端口。
- 没有 HTTPS：页面的离线缓存（service worker `portal/home-sw.js`）在纯 HTTP 下不会注册，其余功能正常；登录用 Bearer token，不依赖 Secure Cookie。有了域名后可加 Caddy 自动签证书。
