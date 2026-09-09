# 薄肌居家训练网站

## 项目定位

面向居家训练的静态训练网站：TRX、引体杆、弹力带、健腹轮与徒手动作；采用“练三天、休一天”的推 / 拉 / 腿核心循环。目标是减脂期维持并适量增加肌肉，打造匀称、紧实的薄肌体型。

## 运行方式

- 直接双击 `index.html`，或部署为静态站点（默认无后端，数据在浏览器 `localStorage`）。
- 可选：`docker compose up -d --build` 一键起「应用 + Postgres」，训练记录同步持久化到数据库，换浏览器 / 设备不丢。
- 部署时必须同时包含 `index.html`、`media-config.js`、`gif-links.js`、`IMG/`、`VIDEO/`。

### Docker 部署（可选）

```bash
docker compose up -d --build   # 构建并启动，访问 http://localhost:3001
docker compose down            # 停止（保留数据）；加 -v 会清空数据库数据
```

- 结构：`app`（node 托管静态站 + 登录 + `/api/state` 读写接口）、`db`（Postgres 16，数据在 `dbdata` 卷）。
- **登录**：首次打开需用账号登录；默认种子账号 `yhone` / `yh159951`（可用环境变量 `SEED_USERNAME`、`SEED_USER_PASSWORD` 覆盖）。密码以 bcrypt 哈希存储；支持注册新账号。
- **数据隔离**：训练记录按登录用户隔离，写入 `workout_records(user_id, key, value)`。
- **不丢数据**：历史记录（无 user_id）会在启动时自动归到种子账号；首次登录后本机 `localStorage` 数据会自动同步进账号；登录页内置「迁移旧数据」粘贴导入工具（旧页面 F12 → Console → `copy(JSON.stringify(localStorage))`）。
- 前端存储层已做兼容：仅 http(s) 部署下启用服务端同步与登录；后端不可用时（如双击 `file://` 打开）自动退化为纯 `localStorage`，功能不变。
- 后端入口：`server/server.js`；数据库连接串用环境变量 `DATABASE_URL` 覆盖。

## 主要文件

- `index.html`：页面、样式、训练计划、计时、RIR、成长、渲染和交互逻辑。
- `gif-links.js`：动作名称到 GIF 的映射及演示提示；改动作名称时必须同步检查。
- `media-config.js`：图片 / 音效路径及音量配置。
- `IMG/`：按热身、推、拉、腿、核心、挑战分类的 GIF。
- `VIDEO/`：开始、暂停、倒计时、Tabata、结束等 WAV 音效。

## 当前训练结构

- 推 / 拉 / 腿核心：主关卡 3 轮、补强 2 轮、可选 3 分钟低冲击 Tabata。
- 拉日 A：引体或弹力带辅助 → TRX 划船 → 面拉；拉日 B 同样优先垂直拉。
- 侧平举为单臂交替，每侧 12–18 次，主要保持 RIR 2–3。
- Tabata 按推拉腿与 A/B 轮换，共 6 种组合；不使用深蹲、弓步或俯卧撑作为结尾挑战。
- 达到 27 分钟或同次出现两项 RIR 0 时，只提示可结束；用户可自行继续挑战。

## 数据与兼容性

所有记录保存在浏览器 `localStorage`。不得随意更改以下键名：

```text
thinMuscleDoneV8
thinMusclePlanVariantV3
thinMuscleWorkoutSessionV3
thinMuscleIntensityRatingsV2
thinMuscleRestSecondsV2
thinMuscleBodyProfileV1
thinMuscleExercisePerformanceV1
thinMuscleGrowthV1
```

## 修改约束

- 只做增量修改，避免整体重构 `index.html`。
- 不删除 A/B、计时、音效、逐轮次数、RIR、动作等级、升级 / 降级、身体趋势等已有能力。
- 重新渲染后必须保留当前训练日；不要默认跳回推日。
- 训练中填写次数、RIR 或调整等级，不能丢失当前计时、轮次与记录。
- 新增或更名动作时，必须同步检查训练数据、等级配置、调整建议与 GIF 映射。

## 回归检查

- 推、拉、腿核心三个训练日均可正常渲染。
- A/B 切换、训练日保持、动作升降级和逐轮 RIR 保存正常。
- 热身、休息、Tabata、倒计时、开始 / 暂停 / 结束音效正常。
- 刷新页面后本地记录可恢复；GIF 路径无缺失。
