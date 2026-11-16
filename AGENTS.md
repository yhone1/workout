# AI 协作约定

## 开发模型（2026-11-16 起，强制）

本机只跑前端。后端、数据库、Redis、MinIO 以及所有其他服务端都在香港服务器 `154.222.23.16`（`ssh hk`）。
不要启动本机 Docker、本地数据库或本地后端容器；本地调试后端按"开发模型"一节用裸跑 Node，仅在用户明确要求时进行。
公开演示槽位是 `ceshi1`–`ceshi8.yhyh0147.top`，分配见 `D:\projects\CESHI-SLOTS.md`。
凭据只在 `D:\projects\_server-credentials.md`，禁止写入本文件、代码、日志或聊天。

- 本项目是正式站，不占用 ceshi 槽位：https://fit.yhyh0147.top 。
- 重新部署：在项目根目录运行 `powershell -ExecutionPolicy Bypass -File tools/deploy-hk.ps1`。只在用户要求上线/发布时运行。
- 用户不再在本机运行本项目。本机不用 Docker（Docker 仅存在于服务器，用于构建和运行正式容器）；不要用 `start.bat` 或 `docker compose up`，也不要加 `--profile local-db`。
- 本地调试（用户明确要求时）直接裸跑 Node，已验证可用：在项目根目录先 `cd server; npm install --omit=dev`（一次性），再 `node --env-file=.env server\server.js`，浏览器开 http://localhost:3000。`--env-file` 必须带，否则读不到 `.env` 的 `DATABASE_URL` 会连回退的本地库。连的是正式库，调试会写库的功能前先小心。

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

- 访问地址：**https://fit.yhyh0147.top**（手机、电脑都用这个）。前面是 Caddy 反向代理，自动申请并续期 Let's Encrypt 证书，HTTP 会跳到 HTTPS。旧地址 http://154.222.23.16/ 也会跳到新域名。本机 http://localhost:3001 已停用，用户不再在本地运行。
- 服务器容器：	hin-muscle-app（compose 项目 thin-muscle，restart=unless-stopped，内存上限 384M，NODE_ENV=production，只在 docker 内网听 3000，不再映射宿主 80）；前面是 	hin-muscle-caddy（caddy:2-alpine，restart=unless-stopped，内存上限 128M，映射 80/443，证书存在卷 	hin-muscle-caddy-data）。代码在服务器 /opt/apps/thin-muscle-workout/src，上一版在 src.prev。app 通过 docker 内网 devstack_default 连接 devstack-postgres:5432/thinmuscle，不走公网端口。
- 机密环境变量（DATABASE_URL、COACH_INVITE_ENCRYPTION_KEY、AI_COACH_API_KEY 等）在服务器 /opt/apps/thin-muscle-workout/app.env（chmod 600，不进仓库）；改了要重新部署才生效。私有媒体在卷 	hin-muscle-private-media。
- **重新部署**：本机项目根目录运行 powershell -ExecutionPolicy Bypass -File tools/deploy-hk.ps1（打包代码→上传→服务器重建容器→等 healthy 且 HTTPS 可用→公网检查），约几分钟。编排文件 deploy/hk/compose.yaml，Caddy 配置 deploy/hk/Caddyfile，服务器脚本 deploy/hk/server-deploy.sh。只在用户要求上线/发布时运行；本地改完代码默认不自动部署。
- 共享 Caddy 站点目录：其他演示站（ceshi1–ceshi8）的配置在 `/opt/caddy/sites/*.caddy`，静态文件在 `/opt/caddy/www/<槽位>`，由本项目 Caddyfile `import` 引入。`tools/deploy-hk.ps1` 重新部署时会保留这些目录，不要删除或把 ceshi 站点写进 `deploy/hk/Caddyfile`。槽位说明见 `/opt/caddy/SLOTS.md` 和 `D:\projects\AGENTS.md`。

- 回滚：ssh hk 后 cd /opt/apps/thin-muscle-workout && rm -rf src && mv src.prev src && cd src。若 src.prev 还是加 Caddy 之前的编排，先把当前的 deploy/hk/compose.yaml 和 deploy/hk/Caddyfile 拷回去，再 docker compose -p thin-muscle -f deploy/hk/compose.yaml up -d --build。
- 看日志：ssh hk docker logs --tail 200 -f thin-muscle-app，Caddy：ssh hk docker logs --tail 200 -f thin-muscle-caddy；状态：ssh hk docker ps --filter name=thin-muscle。
- 验证线上时只读检查或用不影响训练记录的操作（如登录/退出）；不要为测试改写用户的训练记录，不要伪称部署或验证成功。
- 本地调试不再用 start.bat / docker compose（见“开发模型”一节的裸跑 Node 方式）；本机已有停用的旧 app / 旧 db 容器（restart=no），只作备份保留，不要重启它们，也不要另起临时 Web 服务器或改端口。
- 已启用 HTTPS，页面的离线缓存（service worker portal/home-sw.js）可以注册。登录用 Bearer token，不依赖 Secure Cookie。
