# 统一入口与会员授权扩展实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**目标：** 将居家训练、健身房教练/学员模块和会员自助计划并入统一登录入口；由服务端实施会员有效期、角色和资源权限，同时保留旧训练记录与所有现有 `localStorage` 键。

**架构：** 沿用 Express、Postgres 和 `thinMuscleAuthToken`。新增独立 `portal/`、`member/` 前端及访问/会员/自助训练后端模块；`/` 提供登录与模块入口，`/home/` 继续承载旧居家训练，`/gym/` 保持健身房工作台。会员授权与角色分离；教练计划继续按有效教练关系授权。新会员计划单独建模，通过共享训练会话和逐组数据结构保留版本快照，不复用教练计划所有权字段。

**技术栈：** Node.js 20、Express 4、Postgres 16、原生 HTML/CSS/ES Modules、Node `node:test`。

**设计依据：** `docs/superpowers/specs/2026-09-28-coach-student-gym-platform-design.md`（用户已确认）。

## 全局执行约束

- 先验证服务端权限拒绝路径，再接页面；前端隐藏入口不算授权。
- `yhone` 通过数据库中的 `superadmin` 角色获得全权限；普通 `admin` 保留管理工作台能力。总管理员不依赖会员记录。
- 会员有效期按 `Asia/Shanghai` 的日历日期判定，生效日和到期日均包含在内；撤销立即阻止新的会员访问，不删除授权历史或训练数据。
- 有效教练—学员关系仍可访问已发布教练计划，不因缺少会员授权而拦截；该关系不开放居家训练和会员自助计划。
- AI 服务提供方和密钥管理尚未确认。本计划不虚构服务商、不提交密钥，也不以假结果冒充 AI；计划编辑器先支持手动建计划，AI 入口保持明确的“待配置”状态。选定提供方后再补一份可执行的适配器实施步骤。
- 保留旧 `localStorage` 业务键、`workout_records` 表和居家训练行为；只允许新增账户归属/本地快照元数据，不改旧键名。
- 当前旧同步逻辑会在服务器账号没有记录时，把浏览器现有全部训练数据自动上传到当前账号。必须先修复账号切换隔离：无归属的旧数据只能经用户明确确认导入，绝不能静默写入另一账号；切换账号前先备份旧本地快照。
- 执行任何数据库迁移前，先核实外部备份 `D:\projects\thin-muscle-workout-backups\yhone\workout-state-20260928-155710.json` 的可读性、10 条记录、用户名和 SHA-256 `A9640C4E5C14372104A377678482C5C2593E4206BDC4A287755917C3C90B774C`。只核验，不覆盖或导入备份。
- 保留工作区已有改动；不做 Git 写操作、提交、重置或清理。只使用现有 `http://localhost:3001`；不得另起服务、重启、重建或停止容器。若运行中的镜像没有包含变更，报告运行态验收受限并等待用户授权，不用其他服务绕过。

## Review Focus

1. 未登录、过期会员、普通管理员、教练关系学员、`yhone` 总管理员这几条访问分支是否互不混淆；分别有拒绝/放行测试。
2. 会员日期是否按上海时区且到期日当天仍有效；撤销、续期及审计是否可追溯。
3. 从 `gym/app.js` 登录、注册和邀请回跳时是否复用同一令牌、保留原目标且防止外站开放重定向。
4. 账号切换/空账号初始化是否会把 `yhone` 的旧浏览器数据同步给其他人；所有旧键和确认导入前的数据是否保留。
5. 会员自助计划/训练会话是否与教练计划所有权隔离；计划确认后生成不可变版本快照，AI 未配置时不显示伪推荐。

---

## 阶段 1：总管理员与会员授权服务端基础

### Task 1：会员数据模型、角色通配权限和访问判定

**Files:**
- Create: `server/db/migrations/006_membership_access.sql`
- Create: `server/modules/membership-access.js`
- Create: `server/modules/membership-access.test.js`
- Modify: `server/modules/identity-coaching.js`
- Modify: `server/server.js`

**接口约定:**
- `isSuperAdmin(user) -> boolean`：仅检查已从数据库加载的 `superadmin` 角色。
- `hasActiveMembership({ grants, today }) -> grant | null`：纯函数；日期采用 ISO `YYYY-MM-DD`，首尾日期均包含。
- `requireRole(...roles)`：`superadmin` 可通过任何角色保护的管理/教练路由；其他账号仍逐角色匹配。
- `requireMembership({ pool })`：挂在 `auth` 后；总管理员直接放行，其余账号读取未撤销且上海当前日期位于 `[starts_on, expires_on]` 的授权；未授权返回 `403 { error: 'membership_required' }`。
- `GET /api/auth/me`：保留 `userId/username/roles`，增加 `isSuperAdmin`、`membership` 与 `entitlements`（`homeTraining`、`memberPlans`）。不返回其他账号授权详情。

**步骤:**

- [ ] 先为 `membership-access.test.js` 写失败测试：到期日当天有效、次日无效、生效日前无效、被撤销无效；总管理员无会员仍可访问；普通 admin、coach、student 无会员不能访问；superadmin 通过 `requireRole('admin')` 与 `requireRole('coach')`，普通用户不能。
- [ ] 运行 `node --test server/modules/membership-access.test.js`，确认测试先因模块/接口缺失而失败。
- [ ] 在迁移 `006_membership_access.sql` 中将 `user_roles.role` 约束扩展为包含 `superadmin`；为 `yhone` 幂等添加该角色而保留其现有 `admin/student` 角色。
- [ ] 创建 `membership_grants`（用户、`starts_on`、`expires_on`、授予人、创建时间、撤销人/时间、原因）和追加式 `membership_events` 审计表；加日期顺序约束、查询索引及外键，不改现有用户、教练计划或训练记录。
- [ ] 实现纯日期 helper 和 membership middleware；用 `(now() AT TIME ZONE 'Asia/Shanghai')::date` 求服务端当前日期，避免依赖容器默认时区。
- [ ] 更新 `requireRole`，保证 superadmin 通配但普通 admin 不自动绕过非 admin 的角色边界。
- [ ] 更新 `/api/auth/me` 返回访问摘要；新 helper 单测全部通过。
- [ ] 静态检查 `node --check server/server.js`、`node --check server/modules/identity-coaching.js`。

## 阶段 2：管理员会员授权工作流

### Task 2：授权/续期/撤销 API 与独立管理菜单

**Files:**
- Create: `server/modules/memberships.js`
- Create: `server/modules/memberships.test.js`
- Modify: `server/server.js`
- Modify: `gym/admin.js`
- Modify: `gym/styles.css`

**接口约定:**
- `GET /api/admin/users/:userId/membership`：返回当前生效授权（若有）和该账号授权历史。
- `POST /api/admin/users/:userId/membership`，body `{ startsOn, expiresOn, reason }`：校验日期格式/顺序，新增授权和 `granted` 事件；续期新增记录，不覆盖历史。
- `POST /api/admin/memberships/:grantId/revoke`，body `{ reason }`：事务内写撤销字段及 `revoked` 事件；已撤销返回 `409`，错误 ID 返回 `404`。
- 上述接口使用 `auth + requireRole('admin')`，因此总管理员可操作；不得开放给教练或学员。

**步骤:**

- [ ] 先在路由测试中覆盖：学员/教练被拒且不访问数据库；管理员可查/授权/撤销；非法日期返回 `400`；撤销后访问判定失效；续期保留旧记录和审计；重复撤销冲突。
- [ ] 运行 `node --test server/modules/memberships.test.js`，确认新测试先失败。
- [ ] 实现 `mountMembershipRoutes(app, { pool, auth, requireRole })`，授权新增和事件写入放在同一事务中。
- [ ] 在 `server.js` 挂载会员路由；不启动服务。
- [ ] 在管理员工作台增加独立“会员授权”子菜单，不混入“照片审核”或“动作库管理”；提供账号搜索、授权生效日/到期日、当前状态、授权历史、续期和撤销确认。
- [ ] 在管理 UI 测试/可执行静态检查中确认教练端没有该入口，表单不能提交结束早于开始的日期，撤销有二次确认。
- [ ] 运行新路由测试和 `node --check gym/admin.js`。

## 阶段 3：统一登录/训练中心与旧入口兼容

### Task 3：中央入口、登录回跳和静态路由

**Files:**
- Create: `portal/index.html`
- Create: `portal/app.js`
- Create: `portal/styles.css`
- Create: `portal/routes.js`
- Create: `portal/routes.test.js`
- Modify: `server/server.js`
- Modify: `gym/app.js`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

**接口约定:**
- `sanitizeReturnTo(value) -> '/home/' | '/gym/' | '/member/' | '/'`：仅允许站内白名单路径，拒绝绝对 URL、`//host`、反斜线和未知路径。
- 根路径 `/` 返回 portal；`/home/` 静态别名服务现有居家 `index.html`，相对路径媒体仍能从同一 static root 读取；`/gym/` 保持现有静态模块；`/member/` 服务会员计划模块（后续 Task 5 创建文件）。
- Portal 使用原 `/api/auth/login`、`/api/auth/register`、`/api/auth/me` 和 `thinMuscleAuthToken`；不得再发明第二套账号/令牌。

**步骤:**

- [ ] 先为 `portal/routes.test.js` 写回跳测试：允许目标原样返回；外站、协议相对 URL、路径穿越及未知路径统一回 `/`；邀请注册回跳不丢 invite token。
- [ ] 运行 `node --test portal/routes.test.js`，确认测试先失败。
- [ ] 新建响应式训练中心：未登录显示登录/注册；登录后从 `/api/auth/me` 与 `/api/gym/me` 取得能力，只显示有权限的入口和会员有效期/教练计划提示。
- [ ] 在 `server.js` 静态 fallback 前明确注册 `/`、`/home/`、`/gym/`、`/member/` 路由；确保 API 路由优先于静态 fallback，未知 API 不返回 HTML。
- [ ] 在 `gym/app.js` 中让未登录访问回到 `/?returnTo=/gym/`；邀请链接把 token 安全保留到统一入口，登录后仍接受邀请；保留现有已登录工作台和退出登录行为。
- [ ] 更新 Dockerfile 将 `portal/`、`member/` 纳入 `/app/public`，并在 compose 中为新增前端添加只读绑定挂载；不改端口、服务名或启动命令。
- [ ] 运行 `node --test portal/routes.test.js`；检查新增服务端 CommonJS 文件语法，并在允许使用的现有浏览器中加载 portal 与 `/gym/`，确认 ES modules 和本地引用无控制台错误。

## 阶段 4：居家训练会员门禁与旧数据隔离

### Task 4：保护居家 API、页面入口和账号切换同步

**Files:**
- Create: `home-access.js`
- Create: `home-sync.js`
- Create: `home-sync.test.js`
- Modify: `server/server.js`
- Modify: `index.html`（仅最小 bootstrap/access-hook；不新增会员业务页面）
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

**接口约定:**
- `GET /api/state`、`POST /api/state`：先 `auth`，再 `requireMembership`；`yhone` 放行，未登录 `401`，无有效会员 `403 membership_required`。POST 对会员键值行为保持兼容。
- `home-sync.js` 继续读写既有业务键，并增加 `thinMuscleStateOwnerV1` 与可恢复本地快照元数据；不改旧键名。
- `home-access.js` 在旧训练 UI 激活前检查登录态和 entitlement；未登录回统一登录中心，过期/未授权显示状态及可用模块，不显示可操作训练内容。

**步骤:**

- [x] 先写 `home-sync.test.js`：无标记旧数据不向空账号静默上传；用户确认后才导入；账号从 A 切到 B 时先保存 A 快照、再显示 B 的服务端状态/默认状态；网络错误和 `403` 不能退化为可训练的匿名页面；同账号刷新能恢复；旧键名保持原样。
- [x] 运行 `node --test home-sync.test.js`，确认测试先失败。
- [x] 抽取并实现账号归属同步：使用用户 ID 作为 owner；未知归属的旧本地数据只进入明确的“导入此账号”确认步骤；跳过时做可恢复备份后加载当前账号服务器状态，绝不把上一个账号的本地数据写入新账号。
- [x] 修改旧 `initServerSync`/`boot` 最小调用点，使登录与 entitlement 校验成功后才初始化训练；HTTP 服务模式下鉴权失败采取 fail-closed；网络不可用显示服务不可用，不把它当作会员授权成功。`file://` 离线模式在本会员系统中不授予账号权限，不得作为绕过会员门禁的部署入口。
- [x] 对 `/api/state` 的读写路由增加 membership guard；补充单测确认 401/403 下查询/写入均不会执行，原有账号键和 yhone 数据路径不变。
- [x] `home-access.js` 负责回跳、权限状态和简洁阻断页；原有训练 UI、计划、计时、localStorage 业务 key 不重构。
- [x] 运行新增单测、语法和 compose 配置检查，并通过 `rg` 核对旧键名；现有服务浏览器验证未完成，因运行中的 `localhost:3001` 仍是旧服务，未重启/重建。

## 阶段 5：会员手动计划与不可变版本

### Task 5：会员自助计划 API 和独立计划编辑器

**Files:**
- Create: `server/db/migrations/007_member_plans.sql`
- Create: `server/modules/member-plans.js`
- Create: `server/modules/member-plans.test.js`
- Create: `member/index.html`
- Create: `member/app.js`
- Create: `member/styles.css`
- Modify: `server/server.js`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

**接口约定:**
- `GET /api/member/plans`：只返回当前用户自己的计划/版本；所有计划读取和写入都要求当前有效会员授权。
- `POST /api/member/plans/drafts`，body `{ splitType, name, content }`：`splitType` 限定 `ppl|upper_lower|five_day`；仅创建当前用户草稿。
- `PUT /api/member/plans/:planId/draft`：仅允许所有者更新草稿；校验动作来自已启用全站动作库、分化天数/日号/组次/RIR/次数合法。
- `POST /api/member/plans/:planId/confirm`：用户显式确认后追加不可变正式版本；不可覆盖教练计划、已有训练快照或历史版本。
- 所有会员计划 API 使用 `auth + requireMembership`；授权到期后禁止新的计划访问，但数据库中的计划版本和训练历史保留，不删除或改写。

**步骤:**

- [x] 先写测试：无会员访问拒绝；用户 A 不能读写用户 B 计划；教练关系不能替代会员授权；非法动作/分化/组次数值拒绝；未确认草稿不成为当前计划；确认产生新版本且旧版本不变；教练计划数据不被更新。
- [x] 运行 `node --test server/modules/member-plans.test.js`，确认测试先失败。
- [x] 新迁移创建独立 `member_plans` 与 `member_plan_versions` 表，带用户所有者、分化类型、状态、当前版本引用及 JSONB 快照约束；迁移前只核验 yhone 备份，迁移不触碰 `gym_plans` 或 `workout_records`。
- [x] 实现计划内容归一化/验证、所有权检查和“保存草稿→预览→确认版本”事务。成员计划独立表避免把 `coach_id/student_id` 教练所有权结构用于会员自助计划。
- [x] 完成 `member/` 的手动计划流程：选择推拉腿/上下肢/五分化、从已有动作库筛选动作、编辑训练日顺序/组数/次数/RIR/可选重量、预览并确认；显示现有教练计划时明确标为只读，不提供覆盖按钮。
- [x] 在会员编辑器的 AI 区显示“AI 推荐待配置”，不生成假推荐、不发送用户资料到任何外部服务。
- [x] 路由、权限和 UI 静态检查通过；当前浏览器运行实例未加载这些更改，实际页面流程待授权更新服务后验收。

## 阶段 6：会员计划逐组训练记录

### Task 6：复用会话/逐组模型支持自助计划训练

**Files:**
- Create: `server/db/migrations/008_member_plan_sessions.sql`
- Create: `server/modules/member-training.js`
- Create: `server/modules/member-training.test.js`
- Modify: `server/server.js`
- Modify: `member/app.js`
- Modify: `member/styles.css`
- Modify: `server/modules/workouts-measurements.js`（仅共享只读 session-detail/校验 helper；不改变教练路由权限）

**接口约定:**
- `POST /api/member/plans/:planId/sessions`，body `{ dayNo }`：需有效会员及本人已确认的当前计划版本；从版本快照建立会话/逐组目标。
- `PATCH /api/member/sessions/:sessionId/sets/:exerciseIndex/:setNo`：只允许该会话所有者编辑自己的草稿组记录。
- `POST /api/member/sessions/:sessionId/complete` 与 `/abandon`：结束或放弃本人草稿；放弃只标记本草稿，不删历史。
- `GET /api/member/sessions`、`GET /api/member/sessions/:sessionId`：只返回当前用户自己的会员会话。

**步骤:**

- [x] 先写成员会话测试：无会员不能开始会员训练；非所有者不能读写；过期后不能新建训练；已开始草稿刷新可恢复；放弃不改已完成会话；完成会话动作/目标快照保持开始时版本；教练会话权限/数据不变。
- [x] 运行 `node --test server/modules/member-training.test.js`，确认测试先失败。
- [x] 迁移 008 允许 `gym_sessions` 通过互斥来源字段引用教练计划或会员计划版本；保留现有会话的非空 `coach_id/plan_id` 和数据，不回填/删除既有会话；逐组表继续共用。
- [x] 添加成员专属路由，逐组数值校验、所有权、当前草稿状态和会员状态在事务内复核；已完成会话仍只读可查，避免到期用户失去训练历史。
- [x] 从 `workouts-measurements.js` 导出共享只读会话详情映射；旧 coach/student 会话权限保持原状，新增回归用例确保会员会话不能通过旧健身房历史 API 读取。
- [x] 在 `member/app.js` 增加下一训练日、开练、逐组实际重量/次数/RIR、草稿恢复、完成/放弃及历史查看；不得复用教练的编辑 API。所有会员会话 API（包括查询历史）均要求有效会员，过期只保留数据库记录、不开放新接口读取。
- [x] 路由测试和服务端/前端语法检查通过；当前浏览器运行实例未加载这些更改，实际页面流程待授权更新服务后验收。

## 阶段 7：回归验收与 AI 配置门槛

### Task 7：账号/权限/旧训练/响应式端到端回归

**Files:**
- Create: `server/modules/access-regression.test.js`（若现有测试结构可直接覆盖，可并入相关 test 文件，不引入测试依赖）
- Modify as needed only in files listed by the failing regression.

**步骤:**

- [ ] 使用专用测试账号与数据覆盖游客、无会员学员、有效会员、到期会员、教练关系学员、普通 admin、`yhone`；不修改或使用 `yhone` 实际训练记录作为测试数据。
- [ ] 验证授权首尾日期、手动续期/撤销、管理员审计、教练计划免会员访问、教练不能进居家训练、`yhone` 无授权记录仍全权放行。
- [ ] 验证 root 登录/注册/回跳、邀请回跳、`/gym/` 旧流程、`/home/` 媒体和音频相对路径、`/member/` 手动计划和逐组记录；桌面与手机分别检查主入口、登录、授权状态、计划编辑和单组记录操作。
- [ ] 在隔离浏览器 profile/测试账号下验证旧 localStorage key 名不变，未确认的旧数据不外传，切换账号前有可恢复快照；校验 yhone 备份 hash 不变。
- [ ] 运行 `node --test server/modules/*.test.js server/seed/*.test.js portal/*.test.js home-sync.test.js` 和相关 `node --check`；`git diff --check` 仅作为只读检查，不执行任何 Git 写操作。
- [ ] 只对现有 `http://localhost:3001` 做只读页面/API检查。若源码尚未被当前容器挂载，记录“运行态尚未验收”，等用户明确授权后再考虑通过仓库 `start.bat` 更新服务；绝不另起服务。

### AI 计划推荐：明确的后续授权门槛，不在本计划内假实现

AI 推荐属于已确认的产品目标，但服务商、数据处理/隐私范围、密钥保存方式尚未选择，无法写出不臆造的真实集成步骤。此计划仅落实安全的空配置状态。开始 AI provider adapter 前，用户需确认服务商/模型、发送给供应商的用户字段、密钥注入方式（仅服务端环境变量/密钥存储）和失败/额度提示；确认后新增单独计划。其实现须仅生成已审核动作库范围内的可编辑草稿，使用 provider fake 做单测，确认前不得激活。

## 完成定义

- 游客无法进入训练 UI 或会员 API；服务端对会员读写均做有效期检查。
- 普通有教练关系但无会员的学员仍能查看教练计划/历史，但不能进入居家训练、会员计划和会员自助训练记录。
- `yhone` 具有完整管理与训练权限；管理员会员菜单和审计可用，教练不能授予会员或改动作库。
- 各账号的旧浏览器数据不会在切换时串写；旧 key 名和已有记录继续可恢复。
- 会员可建立、确认版本化手动计划，并以逐组记录完成个人训练；教练计划、照片审核、动作库和展示圈原流程无回归。
- AI provider 未选定前，功能明确标记待配置，不把静态推荐或伪造结果称作 AI。
- 所有新增/修改文件通过对应测试和静态检查；运行态验收仅在当前允许使用的 `localhost:3001` 能反映本次改动时作成功声明。
