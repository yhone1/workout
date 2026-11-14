(function exposeHomeAccess(root, createApi) {
  const api = createApi(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    let storage = null;
    try { storage = root.localStorage; } catch {}
    root.HomeAccess = api.createHomeAccess({ homeSync: root.HomeSync, storage, fetchImpl: root.fetch?.bind(root) });
  }
})(globalThis, (root) => {
  function createHomeAccess({
    windowRef = root,
    documentRef = root.document,
    storage = root.localStorage,
    fetchImpl = root.fetch?.bind(root),
    homeSync = root.HomeSync,
    showGate = null,
    clearPending = null,
    navigate = (url) => windowRef.location.replace(url),
    now = Date.now,
  } = {}) {
    const ACCESS_CACHE_KEY = 'thinMuscleHomeAccessV1';
    // Offline entry is only a short bridge from the last server verification,
    // never a substitute for membership checks once the server is reachable.
    const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
    function renderGate(view) {
      if (showGate) return showGate(view);
      const gate = documentRef?.getElementById('homeAccessGate');
      if (!gate) return;
      documentRef.body.classList.add('home-access-pending');
      gate.hidden = false;
      gate.querySelector('[data-gate-title]').textContent = view.title || '';
      gate.querySelector('[data-gate-message]').textContent = view.message || '';
      const actions = gate.querySelector('[data-gate-actions]');
      actions.replaceChildren();
      for (const action of view.actions || []) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = action.primary ? 'home-access-button primary' : 'home-access-button';
        button.textContent = action.label;
        button.addEventListener('click', action.onClick);
        actions.append(button);
      }
    }

    function releaseGate() {
      if (clearPending) return clearPending();
      documentRef?.body?.classList.remove('home-access-pending');
      const gate = documentRef?.getElementById('homeAccessGate');
      if (gate) gate.hidden = true;
    }

    function homeReturnUrl() {
      return '/?returnTo=%2Fhome%2F';
    }

    function returnToCenter() { navigate(homeReturnUrl()); }

    async function fetchProfile() {
      const token = storage.getItem('thinMuscleAuthToken') || '';
      const response = await fetchImpl('/api/auth/me', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data.error || `http_${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (!data || !Number.isSafeInteger(Number(data.userId)) || Number(data.userId) <= 0) throw new Error('invalid_auth_profile');
      return data;
    }

    function canUseHome(profile) {
      return profile.isSuperAdmin === true
        || (Array.isArray(profile.roles) && profile.roles.includes('superadmin'))
        || profile.entitlements?.homeTraining === true;
    }

    function rememberAccess(profile, allowed) {
      try {
        const expiresOn = profile.membership?.expiresOn;
        storage.setItem(ACCESS_CACHE_KEY, JSON.stringify({
          version: 1,
          userId: String(profile.userId),
          allowed,
          expiresOn: typeof expiresOn === 'string' ? expiresOn : null,
          verifiedAt: now(),
        }));
      } catch {}
    }

    function offlineAccess() {
      let cached = null;
      try { cached = JSON.parse(storage.getItem(ACCESS_CACHE_KEY) || 'null'); } catch { return null; }
      if (!cached || cached.version !== 1 || cached.allowed !== true) return null;
      const userId = String(cached.userId ?? '');
      if (!/^[1-9]\d*$/.test(userId)) return null;
      const verifiedAt = Number(cached.verifiedAt);
      if (!Number.isFinite(verifiedAt) || verifiedAt > now() + 5 * 60 * 1000) return null;
      if (now() - verifiedAt > OFFLINE_GRACE_MS) return null;
      if (cached.expiresOn) {
        const expiresAt = Date.parse(`${cached.expiresOn}T23:59:59`);
        if (Number.isFinite(expiresAt) && now() > expiresAt) return null;
      }
      // Without a matching owner marker, local records may belong to another
      // account and must not be shown offline.
      const ownerKey = homeSync?.OWNER_KEY || 'thinMuscleStateOwnerV1';
      if ((storage.getItem(ownerKey) || '') !== userId) return null;
      return { userId, verifiedAt };
    }

    function blocked(message, title = '暂时无法进入居家训练') {
      renderGate({
        title,
        message,
        actions: [
          { label: '返回训练中心', primary: true, onClick: returnToCenter },
          { label: '查看健身房计划', onClick: () => navigate('/gym/') },
        ],
      });
      return { allowed: false };
    }

    async function resolveLegacyImport(sync, prepared) {
      const count = Object.keys(prepared.localValues || {}).length;
      return new Promise((resolve) => {
        let busy = false;
        const finish = async (importLegacy) => {
          if (busy) return;
          busy = true;
          renderGate({ title: '正在安全处理训练记录', message: '验证账号云端状态并保存本机快照…' });
          try {
            const result = await sync.completeLegacyImport({ userId: prepared.userId, prepared, importLegacy });
            if (result.status === 'cloud_conflict') {
              busy = false;
              renderGate({
                title: '账号云端已有记录',
                message: '为避免覆盖云端训练记录，旧数据没有导入；本机快照已保留。你可以继续使用当前账号的云端记录。',
                actions: [{ label: '使用云端记录', primary: true, onClick: () => finish(false) }],
              });
              return;
            }
            releaseGate();
            resolve({ allowed: true, userId: result.userId, imported: result.imported });
          } catch (error) {
            busy = false;
            if (error.status === 403) storage.removeItem(ACCESS_CACHE_KEY);
            const message = error.status === 403
              ? '会员授权已失效或尚未生效。训练数据未被改动。'
              : error.status === 401
                ? '登录已失效。训练数据未被改动。'
                : '服务暂不可用，训练数据未被改动。';
            renderGate({
              title: '尚未完成数据初始化', message,
              actions: [
                { label: '重试', primary: true, onClick: () => windowRef.location.reload() },
                { label: '返回训练中心', onClick: returnToCenter },
              ],
            });
            if (error.status === 401) {
              storage.removeItem('thinMuscleAuthToken');
              navigate(homeReturnUrl());
            }
          }
        };

        renderGate({
          title: '发现未归属账号的旧训练数据',
          message: `已先保存 ${count} 项本机记录的可恢复快照。选择是否将它们导入当前账号；不导入会载入该账号云端记录，不会删除快照。`,
          actions: [
            { label: '导入到当前账号', primary: true, onClick: () => finish(true) },
            { label: '不导入，使用云端记录', onClick: () => finish(false) },
          ],
        });
      });
    }

    async function bootstrap() {
      if (windowRef.location.protocol === 'file:') {
        return blocked('居家训练需要服务器验证账号和会员权限。请从训练中心登录后进入，离线打开不会授予访问权限。', '请通过训练中心访问');
      }
      // HTTP 环境降级：局域网 HTTP 访问时，Wake Lock/PWA/离线功能不可用
      if (windowRef.location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(windowRef.location.hostname)) {
        console.warn('当前为 HTTP 环境，屏幕常亮、PWA 安装、离线功能不可用；建议通过 HTTPS 访问以获得完整体验。');
      }
      if (!storage || typeof storage.getItem !== 'function') {
        return blocked('本机存储不可用，无法安全恢复训练记录。请检查浏览器存储设置后重试。', '无法安全读取训练记录');
      }
      const token = storage.getItem('thinMuscleAuthToken');
      if (!token) {
        returnToCenter();
        return { allowed: false };
      }
      renderGate({ title: '正在验证账号权限', message: '确认会员期限并检查本机记录归属…' });
      let profile;
      try {
        profile = await fetchProfile();
      } catch (error) {
        if (error.status === 401) {
          storage.removeItem('thinMuscleAuthToken');
          storage.removeItem(ACCESS_CACHE_KEY);
          returnToCenter();
          return { allowed: false };
        }
        const cached = (!error.status || error.status >= 500) ? offlineAccess() : null;
        if (cached) {
          releaseGate();
          return { allowed: true, userId: cached.userId, offline: true, verifiedAt: cached.verifiedAt };
        }
        return blocked('当前无法连接验证服务，且本机没有可用的离线授权；训练页面保持锁定。本机训练记录不会上传或清除。', '暂时无法验证权限');
      }
      rememberAccess(profile, canUseHome(profile));
      if (!canUseHome(profile)) {
        const membership = profile.membership || {};
        const status = membership.active
          ? `会员期限：${membership.startsOn || '—'} 至 ${membership.expiresOn || '—'}。`
          : '当前账号没有有效的居家训练会员期限。';
        return blocked(`${status}训练数据保持不变；如需开通，请联系教练或管理员。`, '居家训练尚未开放');
      }
      if (!homeSync || typeof homeSync.createHomeSync !== 'function') {
        return blocked('训练数据同步模块未能加载，训练页面保持锁定。', '无法安全读取训练记录');
      }
      try {
        const sync = homeSync.createHomeSync({ storage, fetchImpl });
        const prepared = await sync.prepareAccount({ userId: profile.userId });
        if (prepared.status === 'legacy_import_confirmation') return await resolveLegacyImport(sync, prepared);
        releaseGate();
        return { allowed: true, userId: String(profile.userId), notice: prepared.notice || null };
      } catch (error) {
        if (error.status === 401) {
          storage.removeItem('thinMuscleAuthToken');
          storage.removeItem(ACCESS_CACHE_KEY);
          returnToCenter();
          return { allowed: false };
        }
        if (error.status === 403) storage.removeItem(ACCESS_CACHE_KEY);
        const message = error.status === 403
          ? '会员授权已失效或尚未生效。训练页面保持锁定，记录没有清除。'
          : '服务暂不可用，训练页面保持锁定；不会把本机数据同步到其他账号。';
        return blocked(message, error.status === 403 ? '居家训练权限已失效' : '训练数据尚未安全恢复');
      }
    }

    return { bootstrap };
  }

  return { createHomeAccess };
});
