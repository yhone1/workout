# 教练邀请轮换与学员名额实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持教练端单次邀请链接自动轮换、受邀请注册/绑定原子化，以及总管理员可配置的教练分级学员上限。

**Architecture:** 沿用 Express、Postgres 和现有账号/关系模型，新增独立名额与邀请服务模块。邀请码仍以哈希验证，另用 `COACH_INVITE_ENCRYPTION_KEY` 做 AES-256-GCM 加密，使其仅能由所属教练重新查看；绑定和名额变更使用事务及教练行锁防止越限。

**Tech Stack:** Node.js 20、Express 4、Postgres 16、原生 HTML/CSS/ES Modules、Node `node:test`、Node `crypto`。

**Spec:** `docs/superpowers/specs/2026-09-30-coach-invitation-capacity-design.md`

## Global Constraints

- 保留现有账号、角色、关系、训练计划、训练记录、身体数据、照片、`workout_records` 和全部 `localStorage` 键。
- 无邀请码时的注册政策保持现状，不把未定的自注册策略混入本次改动。
- 邀请密钥为 base64 编码的 32 字节随机值；不得提交、回显或记录密钥、邀请码明文或完整邀请链接。
- 缺少密钥时服务仍可运行，但不得创建/展示新的可恢复邀请码；不得降级为明文存储。
- 只有 `superadmin` 可以管理教练等级和个人名额；每个接受邀请路径都在服务端检查教练资格、唯一教练关系及有效上限。
- 上限降低不解除现有关系；未配置名额等同禁止新增绑定，不等同无限名额。
- 保留升级前的邀请和关系；旧码仍需经过新资格/容量检查，成功消费后过渡为可恢复的新码。
- 不清理或覆盖工作区现有改动，不修改 `yhone` 居家训练记录，不做 Git 写操作/提交。
- 只复用 `http://localhost:3001`；不另起服务、改端口、重启、重建或停止容器。运行态更新需用户另行明确授权。

## 文件职责

- `server/db/migrations/009_coach_invitation_capacity.sql`：加教练等级/名额/审计结构与邀请码密文字段、当前码约束；保留旧数据。
- `server/modules/coach-capacity.js`：有效名额纯函数及总管理员名额 API。
- `server/modules/coach-invitations.js`：密钥校验、加解密、邀请生成/展示/接受/轮换与教练解除关系的事务流程。
- `server/modules/invitation-registration.js`：受邀请注册事务，创建账号、关系、邀请码状态和登录会话要么全部成功、要么全部回滚。
- `server/server.js`：注入密钥配置、挂载新路由、将带邀请码注册路由交给事务服务；保留无邀请码的现有注册路径。
- `server/modules/*.test.js`：按服务边界测试名额、加密、邀请并发/一次性和注册原子性。
- `portal/routes.js` 与 `portal/routes.test.js`：解析本站邀请 URL/兼容旧裸 token 的纯函数及测试。
- `portal/app.js`：新用户以一次请求注册并绑定；已有用户登录后仍走已登录绑定路径。
- `gym/coach.js`：教练名额状态、当前码复制、历史码和替换/撤销交互。
- `gym/student.js`：已注册学员粘贴完整本站邀请链接并接受，兼容旧裸 token。
- `gym/capacity-view.js`：可由 Node 测试的前端名额状态/总管理员可见性纯函数，以浏览器全局 `GymCapacityView` 暴露给 UI 模块。
- `gym/admin.js`：仅总管理员显示“教练名额”菜单，维护等级及教练的等级/覆盖值。
- `docker-compose.yml` 与 `PROJECT.md`：传递并说明稳定保管 `COACH_INVITE_ENCRYPTION_KEY` 的配置要求，不写入密钥值。

## Review Focus

1. 同一名额最后一个位置被两个并发注册/接受竞争时不得超员；由 Task 3 的并发接受测试覆盖。
2. 邀请注册失败不得留下用户、角色、关系或会话残骸；由 Task 4 的事务回滚测试覆盖。
3. 密钥缺失、密文标签篡改或错误密钥不得泄露/展示 token，也不得影响旧码哈希校验；由 Task 3 的密码学测试覆盖。
4. 普通管理员、其他教练及学员不能读取或更改名额/当前邀请；由 Task 2/3 的路由授权测试覆盖。
5. 升级前待用邀请和既有关联、无邀请码独立注册及旧训练状态必须保留；由 Task 1/4/5 的兼容测试覆盖。

---

### Task 1: 名额数据模型与容量策略

**Files:**
- Create: `server/db/migrations/009_coach_invitation_capacity.sql`
- Create: `server/db/migrate.test.js`
- Create: `server/modules/coach-capacity.js`
- Create: `server/modules/coach-capacity.test.js`

**Interfaces:**
- Produces `resolveCoachLimit({ tierLimit, overrideLimit }) -> number | null`：个人覆盖值非 `null` 时优先，否则取等级上限；二者都未配置时返回 `null`。
- Produces `capacitySnapshot({ activeStudents, maxStudents }) -> { activeStudents, maxStudents, remaining, canAccept }`：未配置时 `canAccept=false`、`remaining=0`；上限 0 表示不可招收；已有人数高于新上限时保留关系且 `remaining=0`。

- [x] **Step 1: 写失败测试**：在 `coach-capacity.test.js` 覆盖个人覆盖优先、继承等级、未配置 fail-closed、上限 0、正好满额、调低后超额保留关系；在 `migrate.test.js` 验证迁移版本不会在后续启动被重复执行。
- [x] **Step 2: 运行测试确认失败**：`node --test server/modules/coach-capacity.test.js`；预期策略导出缺失导致失败。
- [x] **Step 3: 写迁移**：创建 `coach_capacity_tiers`、`coach_capacity_settings`、`coach_capacity_events`；等级/个人上限约束为非负整数；名额审计保存 actor、目标、事件类型、前后 JSON 和时间。给 `coach_invitations` 加 `token_ciphertext`、`token_nonce`、`token_auth_tag`、`token_key_version`、`is_current`；约束加密字段全空或全有，并用部分唯一索引保证每个教练至多一条未消费/未撤销的 `is_current` 记录。旧邀请默认非当前且加密字段为空，不删除/撤销旧行。
- [x] **Step 4: 实现容量纯函数**：在 `coach-capacity.js` 按上述签名实现策略，不读用户资料，不推断无限上限。
- [x] **Step 5: 运行测试**：`node --test server/modules/coach-capacity.test.js server/db/migrate.test.js`；预期全部 PASS。
- [x] **Step 6: 静态检查迁移边界**：核对迁移只新增上述结构/列，不更新或删除 users、relationships、workouts、measurements、photos 或 `workout_records`；不在此任务对当前数据库执行迁移。

### Task 2: 总管理员名额 API 与授权审计

**Files:**
- Modify: `server/modules/coach-capacity.js`
- Modify: `server/modules/coach-capacity.test.js`
- Modify: `server/server.js`

**Interfaces:**
- `GET /api/admin/coach-capacity?q=` 返回 `{ tiers, coaches, events }`，教练结果只含 ID、用户名、等级、个人覆盖值、有效上限、活跃人数和剩余名额；events 限最近 100 条。
- `POST /api/admin/coach-capacity/tiers` body `{ name, maxStudents, sortOrder }`；`PATCH /api/admin/coach-capacity/tiers/:tierId` 更新这些字段；`DELETE` 仅在无教练指派时成功。
- `PUT /api/admin/coach-capacity/coaches/:coachId` body `{ tierId: number|null, maxStudentsOverride: number|null }`，`null` 表示继承或未配置。
- 所有 API 使用 `auth + requireRole('superadmin')`，每项修改与对应 `coach_capacity_events` 审计写入同一事务。

- [x] **Step 1: 写失败路由测试**：验证普通 admin/coach/student 被拒且不访问数据库；覆盖等级名额校验、重复名称、被指派等级不可删除、个人覆盖优先、等级变更审计、指派账号必须有 coach/admin 资格、非法 coach ID。
- [x] **Step 2: 运行测试确认失败**：`node --test server/modules/coach-capacity.test.js`；预期路由尚未注册。
- [x] **Step 3: 实现管理路由**：在等级编辑、等级指派/覆盖修改中锁定相关 coach 行（多个 coach 按 ID 升序）并事务写审计；不自动解除关系或改变学员数据。
- [x] **Step 4: 在 `server.js` 挂载容量路由**：传入现有 `pool`、`auth` 与 `requireRole`；不改用户角色授权路径。
- [x] **Step 5: 运行授权与事务测试**：`node --test server/modules/coach-capacity.test.js`；预期 403 路由不触库，修改与审计成功/失败原子一致。

### Task 3: 加密可恢复邀请与关系事务

**Files:**
- Create: `server/modules/coach-invitations.js`
- Create: `server/modules/coach-invitations.test.js`
- Modify: `server/modules/identity-coaching.js`
- Modify: `server/server.js`

**Interfaces:**
- `parseInviteEncryptionKey(encoded) -> Buffer`：严格要求 base64 解码后 32 字节；未配置/无效时返回可识别的 `invite_encryption_not_configured`。
- `encryptInviteToken(token, key) -> { tokenHash, ciphertext, nonce, authTag, keyVersion: 1 }`；`decryptInviteToken(record, key) -> token`；解密认证失败或未知版本不得返回 token。
- `acceptInvitation(client, { token, studentId, encryptionKey }) -> { relationship, coachCapacity }`：调用方须处于事务中；不提交/回滚事务。负责锁定邀请码及关联用户、校验资格/唯一教练/有效上限、消费旧码并在有空位时创建下一枚码。
- `POST /api/coach/invitations/current` 幂等返回当前链接及容量快照；`POST /api/coach/invitations/current/replace` 显式作废并替换；`GET /api/coach/invitations` 返回历史但不返回历史 token。
- 保留旧 `POST /api/coach/invitations` 为 current ensure 的兼容别名，并保留 `DELETE /api/coach/invitations/:id` 撤销路径；不得再由旧端点创建并存的第二枚当前码。
- 新码有效期默认 7 天，替换请求可传 `validDays`，服务端限于 1–14 天；当前码过期后不接受，教练工作台再次 ensure 时保留历史并创建新码。
- `POST /api/coach/invitations/accept` 保留现有 URL，已登录学员提交 token 后创建关系；`POST /api/coach/students/:studentId/end` 保留现有 URL，并在事务中释放名额、按规则恢复当前码。

- [x] **Step 1: 写加密/策略失败测试**：覆盖 32 字节 base64 密钥、缺失/错误格式密钥、随机 nonce、加密往返、密文/标签篡改拒绝、hash 匹配与旧行可继续按哈希接受。
- [x] **Step 2: 运行测试确认失败**：`node --test server/modules/coach-invitations.test.js`；预期加密 helper 尚未导出。
- [x] **Step 3: 实现纯加密 helper**：用 Node `crypto` 的 AES-256-GCM；token 仍为高熵随机值，SHA-256 hash 作为数据库唯一查询值；明文仅短暂存在于调用栈/所属教练响应。
- [x] **Step 4: 写邀请事务失败测试**：覆盖已使用/过期/撤销码、教练资格失效、学员已有教练、未配置/已满、密钥缺失时接受不改变关系/邀请码、并发争抢最后名额、成功绑定后旧码及其他待用码失效、上限内新码生成、满额不生成、结束关系释放后恢复码。
- [x] **Step 5: 实现 current/accept/end 路由事务**：接受流程在任何关系/码状态变化前确认密钥有效；事务统一先锁 coach/student 用户行（按 ID 升序），检查最新上限和活跃人数，绑定、消费/撤销码、关系和替代码一起提交。消费/撤销/替换后清空旧密文、nonce、tag，仅保留哈希与状态历史。过期旧码仍拒绝接受。解除关系即使缺少密钥也应先可靠结束关系、释放名额，但不伪造替代码；配置恢复后 ensure 可生成新码。
- [x] **Step 6: 保持旧接口兼容并挂载密钥**：现有 accept/end URL 不变；在 `server.js` 从 `COACH_INVITE_ENCRYPTION_KEY` 解析密钥注入服务，缺失时服务启动继续正常，但新码创建/展示返回配置错误。
- [x] **Step 7: 运行邀请与身份回归**：`node --test server/modules/coach-invitations.test.js server/modules/identity-coaching.test.js`；预期邀请权限、一次性、并发容量及既有角色/学员列表测试全过。

### Task 4: 邀请注册原子化与已注册学员贴链

**Files:**
- Create: `server/modules/invitation-registration.js`
- Create: `server/modules/invitation-registration.test.js`
- Modify: `server/server.js`
- Modify: `portal/app.js`
- Modify: `portal/routes.js`
- Modify: `portal/routes.test.js`
- Modify: `gym/student.js`

**Interfaces:**
- `registerWithInvitation({ pool, username, passwordHash, sessionToken, sessionExpiresAt, invitationToken, encryptionKey }) -> { token, username, userId, roles, relationship }`：用户名、学员角色、关系、旧码消费、新码及登录会话在一个事务内成功或回滚。
- `PortalRoutes.extractInviteToken(value, origin) -> token | null`：接受本站邀请 URL 的 hash token；兼容符合现有长度约束的裸 token；拒绝异站 URL、畸形 URL 和缺失 token。
- `/api/auth/register` 无邀请码时维持现有独立注册行为；带 `invitationToken` 时调用事务注册服务。登录路径仍登录成功后接受已有邀请。

- [x] **Step 1: 写失败的 URL 解析测试**：在 `portal/routes.test.js` 覆盖本站完整邀请链接、本站路径带片段、兼容裸 token、异站链接拒绝、无 token/非法 token 返回 null。
- [x] **Step 2: 运行确认测试失败**：`node --test portal/routes.test.js`；预期 `extractInviteToken` 缺失。
- [x] **Step 3: 实现解析 helper**：按 `origin` 校验 URL 同源，从 hash `invite` 字段取值；不得导航到传入地址。
- [x] **Step 4: 写失败的注册事务测试**：覆盖成功时用户/角色/关系/session/替换码一并提交；无效码、满额、已绑定教练时全部回滚且不留下账号或 session；用户名冲突保留既有账号；不带 token 不进入邀请事务。
- [x] **Step 5: 实现受邀请注册服务**：密码 hash 和随机 session token 在事务外准备；事务内创建用户/学员角色，调用 Task 3 的邀请接受 helper，插入登录 session 后统一提交。
- [x] **Step 6: 更新注册 API 与 Portal**：仅邀请注册把 hash 中 token 发给注册端点；注册成功直接进入已绑定状态，不再重复调用 accept；登录邀请仍走原 accept API。独立注册表单和文案不改变。
- [x] **Step 7: 更新学员贴链输入**：把输入提示改为粘贴教练完整邀请链接，调用 `extractInviteToken` 后才请求 accept；保留旧裸 token 兼容和当前关系错误提示。
- [x] **Step 8: 运行注册/解析测试**：`node --test server/modules/invitation-registration.test.js portal/routes.test.js`；预期回滚与同源解析均 PASS。

### Task 5: 教练与总管理员工作台、配置说明和回归

**Files:**
- Modify: `gym/coach.js`
- Modify: `gym/admin.js`
- Modify: `gym/index.html`
- Modify: `gym/styles.css`
- Create: `gym/capacity-view.js`
- Create: `gym/capacity-view.test.js`
- Modify: `docker-compose.yml`
- Modify: `PROJECT.md`
- Modify: targeted `server/modules/*.test.js` and `portal/routes.test.js` only if regression exposes a defect.

**Interfaces:**
- 教练工作台读取 Task 3 的当前邀请/容量响应；满额或未配置时显示原因，不给出可用链接。
- 总管理员工作台只对 `superadmin` 展示“教练名额”子菜单，调用 Task 2 的等级/指派/覆盖 API；普通管理员菜单不显示且 API 仍返回 403。
- `GymCapacityView.canManageCapacity(roles) -> boolean` 仅在角色包含 `superadmin` 时返回 true；`getCoachCapacityView({ activeStudents, maxStudents, encryptionConfigured })` 返回 `key_missing|unconfigured|full|ready` 状态及剩余名额，按密钥、配置、满额、可招收顺序判定。
- Compose 将 `COACH_INVITE_ENCRYPTION_KEY` 作为可选环境变量传给 app（未配置时服务仍启动、邀请新建被安全拒绝）；`PROJECT.md` 说明生成/保存 32 字节 base64 key、不得提交，并保持重启/恢复时一致。

- [x] **Step 1: 写失败的名额视图测试**：新建 `capacity-view.test.js`，覆盖仅 superadmin 可管理、未配置密钥优先显示配置问题、无有效名额显示未配置、达到/超过上限显示满额、低于上限返回正确剩余位。
- [x] **Step 2: 运行测试确认失败**：`node --test gym/capacity-view.test.js`；预期 `GymCapacityView` helper 不存在。
- [x] **Step 3: 实现视图 helper**：在 `capacity-view.js` 通过 UMD 暴露 `canManageCapacity` 与 `getCoachCapacityView`，并在 `gym/index.html` 作为经典脚本加载；Node 测试使用 `require`，浏览器 UI 使用 `window.GymCapacityView`。
- [x] **Step 4: 实现总管理员名额界面**：等级可添加/编辑/删除；教练可指派等级、设置/清除个人覆盖值；显示当前人数/有效上限；删除被使用等级和非法上限需给出明确反馈。导航入口必须使用 helper 隐藏于非 superadmin。
- [x] **Step 5: 实现教练邀请界面**：显示当前人数/上限/剩余位、可再次查看/复制的当前邀请链接与过期时间；历史邀请不显示 token；提供显式替换/撤销并二次确认；密钥未配置、未分级、满额分别显示对应原因。
- [x] **Step 6: 更新环境说明**：Compose 使用 `${COACH_INVITE_ENCRYPTION_KEY:-}` 传值，不提交真实密钥；在 `PROJECT.md` 写明 base64 32 字节生成方式、稳定保存和更换密钥前轮换当前码的要求。
- [ ] **Step 7: 做静态/UI 检查**：JS 语法、Compose 配置和实际登录后的管理员/教练页面已检查；桌面 1280px 与手机 390×844 均渲染，手机无横向溢出，菜单和未配置名额提示正确。由于 yhone 尚无教练名额，未创建真实邀请，故复制/替换及邀请失败提示的在线交互仍待后续有测试教练名额时验证；相关服务端分支有离线测试覆盖。
- [x] **Step 8: 执行完整离线回归**：`node --test server/modules/*.test.js server/seed/*.test.js portal/*.test.js gym/capacity-view.test.js home-sync.test.js home-access.test.js`；123/123 通过，会员、计划/训练、照片和居家同步测试均通过。
- [x] **Step 9: 运行态更新与核对**：在用户明确回复“继续”授权后，重建 app 镜像并通过现有 `start.bat` 更新服务；应用启动自动应用迁移 `009_coach_invitation_capacity`。验证 app key 为有效 32 字节 Base64（不输出密钥）、数据库迁移版本存在、yhone 的 10 条 `workout_records` 数量不变、`http://localhost:3001/` 与相关资源返回 HTTP 200；未改动 yhone 训练记录或创建真实邀请。
- [x] **Step 10: 检查工作区差异**：只读查看相关工作区状态并运行 `git diff --check`；保留所有不属于本任务的既有改动，不 add/commit/reset/checkout。

Task 5 runtime caveat: service update and additive migration are complete. Step 7 remains partially pending only for an actual current-invite copy/replacement/error flow; this was intentionally not enabled by changing yhone's currently unconfigured coach cap during acceptance.
