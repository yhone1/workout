# AI 协作约定

本文件是本仓库供 Codex、Claude Code、Gemini CLI、Cursor 等 AI 编码工具共用的项目指引。开始处理仓库任务前先阅读本文件和 `PROJECT.md`。

## 本地网站服务（强制）

- 本项目约定的本地网站地址是 `http://localhost:3001`，由仓库根目录的 `start.bat` 管理；该脚本通过 Docker Compose 启动应用。
- 用户通常已经启动该服务。浏览器验证前先对 `http://localhost:3001` 做只读检查，并复用这个现有实例。
- 禁止为了预览、调试或测试另起 Node、Python、Vite、Live Server、Playwright 等临时 Web 服务器；禁止改用其他端口或再启动一套容器。
- 不要擅自运行 `start.bat`、`docker compose up`、`docker compose up --build`、`docker compose restart`、`docker compose down`，也不要终止或重启相关进程。只有用户明确要求启动、重建或重启服务时，才按其要求操作；启动时只使用 `start.bat`，不要另建替代服务。
- 如果 `http://localhost:3001` 不可访问且用户没有要求启动服务，不要用其他端口绕过；继续完成可独立进行的静态检查，并告知用户现有服务不可访问，等待其指示。
- 验收时不得为了测试覆盖用户当前浏览器或训练记录；不要伪称服务已启动、重启或验证成功。
