(function exposeHomeSync(root, createApi) {
  const api = createApi();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeSync = api;
})(globalThis, () => {
  const LEGACY_KEYS = Object.freeze([
    'thinMuscleDoneV8',
    'thinMusclePlanVariantV3',
    'thinMuscleWorkoutSessionV3',
    'thinMuscleIntensityRatingsV2',
    'thinMuscleRestSecondsV2',
    'thinMuscleBodyProfileV1',
    'thinMuscleExercisePerformanceV1',
    'thinMuscleGrowthV1',
    'thinMuscleMrtV1',
    'thinMuscleCindyV1',
    'thinMuscleHomePlanV1',
  ]);
  const OWNER_KEY = 'thinMuscleStateOwnerV1';
  const SNAPSHOT_PREFIX = 'thinMuscleLocalSnapshotV1:';
  const TOKEN_KEY = 'thinMuscleAuthToken';

  function readKnownValues(storage) {
    return Object.fromEntries(LEGACY_KEYS
      .map((key) => [key, storage.getItem(key)])
      .filter(([, value]) => value !== null));
  }

  function normalizeServerState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_server_state');
    return Object.fromEntries(LEGACY_KEYS
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => [key, String(value[key])]));
  }

  function createHomeSync({ storage, fetchImpl = fetch, now = Date.now } = {}) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      throw new TypeError('storage is required');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

    function headers(json = false) {
      const token = storage.getItem(TOKEN_KEY) || '';
      return {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(json ? { 'Content-Type': 'application/json' } : {}),
      };
    }

    async function requestState(method = 'GET', body) {
      const response = await fetchImpl('/api/state', {
        method,
        headers: headers(method === 'POST'),
        ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const error = new Error(payload.error || `http_${response.status}`);
        error.status = response.status;
        throw error;
      }
      if (method === 'POST') return {};
      return normalizeServerState(await response.json());
    }

    function archive(ownerId, entries, reason) {
      if (!Object.keys(entries).length) return null;
      const ownerPart = ownerId == null ? 'unowned' : encodeURIComponent(String(ownerId));
      const stamp = Math.max(0, Number(now()) || 0);
      let key = `${SNAPSHOT_PREFIX}${ownerPart}:${stamp}`;
      let suffix = 1;
      while (storage.getItem(key) !== null) key = `${SNAPSHOT_PREFIX}${ownerPart}:${stamp}:${suffix++}`;
      const snapshot = {
        version: 1,
        ownerId: ownerId == null ? null : String(ownerId),
        savedAt: new Date(stamp).toISOString(),
        reason,
        entries,
      };
      storage.setItem(key, JSON.stringify(snapshot));
      return key;
    }

    function applyRemote(remote, { replace = true, extra = {} } = {}) {
      if (replace) LEGACY_KEYS.forEach((key) => storage.removeItem(key));
      for (const [key, value] of Object.entries({ ...remote, ...extra })) {
        if (LEGACY_KEYS.includes(key) && value !== undefined && value !== null) storage.setItem(key, String(value));
      }
    }

    async function prepareAccount({ userId }) {
      const accountId = String(userId ?? '').trim();
      if (!accountId) throw new TypeError('userId is required');
      const previousOwner = storage.getItem(OWNER_KEY) || null;
      const localValues = readKnownValues(storage);
      // Read the target account first. A failed request must never clear or reassign local data.
      const remote = await requestState('GET');
      const remoteHasData = Object.keys(remote).length > 0;
      let snapshotKey = null;
      if (previousOwner !== accountId && Object.keys(localValues).length) {
        snapshotKey = archive(previousOwner, localValues, previousOwner ? 'account_switch' : 'legacy_unowned_data');
      }

      if (previousOwner === accountId) {
        const locallyOwnedMissingKeys = Object.fromEntries(Object.entries(localValues)
          .filter(([key]) => remote[key] === undefined));
        // A locally saved plan may still be waiting for a failed upload. Preserve
        // the newer copy only for this same owner; account switches remain isolated.
        const planKey = 'thinMuscleHomePlanV1';
        const stamp = (raw) => { try { return Number(JSON.parse(raw)?.updatedAt) || 0; } catch { return 0; } };
        if (stamp(localValues[planKey]) > stamp(remote[planKey])) locallyOwnedMissingKeys[planKey] = localValues[planKey];
        // Rounds, reps and the frozen session are one snapshot. A refresh during
        // the debounce window must not combine new local rounds with old cloud reps.
        if (stamp(localValues.thinMuscleWorkoutSessionV3) > stamp(remote.thinMuscleWorkoutSessionV3)) {
          for (const key of LEGACY_KEYS) {
            if (!['thinMuscleHomePlanV1', 'thinMuscleBodyProfileV1', 'thinMuscleRestSecondsV2'].includes(key)
                && localValues[key] !== undefined) locallyOwnedMissingKeys[key] = localValues[key];
          }
        }
        if (Object.keys(locallyOwnedMissingKeys).length) await requestState('POST', locallyOwnedMissingKeys);
        applyRemote(remote, { replace: false, extra: locallyOwnedMissingKeys });
        return { status: 'ready', userId: accountId, archived: false };
      }

      if (!previousOwner && Object.keys(localValues).length && !remoteHasData) {
        return {
          status: 'legacy_import_confirmation',
          userId: accountId,
          localValues,
          remote,
          snapshotKey,
        };
      }

      applyRemote(remote);
      storage.setItem(OWNER_KEY, accountId);
      return {
        status: 'ready', userId: accountId, archived: Boolean(snapshotKey),
        notice: snapshotKey && !previousOwner && remoteHasData ? 'legacy_backup_cloud_state_used' : null,
      };
    }

    async function completeLegacyImport({ userId, prepared, importLegacy }) {
      const accountId = String(userId ?? '').trim();
      if (!prepared || prepared.status !== 'legacy_import_confirmation' || String(prepared.userId) !== accountId) {
        throw new Error('invalid_legacy_import_state');
      }
      const remote = await requestState('GET');
      const remoteHasData = Object.keys(remote).length > 0;
      if (importLegacy && remoteHasData) {
        return { status: 'cloud_conflict', userId: accountId };
      }
      if (importLegacy && Object.keys(prepared.localValues).length) {
        await requestState('POST', prepared.localValues);
      }
      applyRemote(remote, { extra: importLegacy ? prepared.localValues : {} });
      storage.setItem(OWNER_KEY, accountId);
      return { status: 'ready', userId: accountId, imported: Boolean(importLegacy) };
    }

    async function syncOwned({ userId }) {
      const accountId = String(userId ?? '').trim();
      if (!accountId || storage.getItem(OWNER_KEY) !== accountId) return false;
      const localValues = readKnownValues(storage);
      try {
        await requestState('POST', localValues);
        return true;
      } catch (error) {
        if (error.status === 401 || error.status === 403) throw error;
        return false;
      }
    }

    return { prepareAccount, completeLegacyImport, syncOwned };
  }

  return { createHomeSync, LEGACY_KEYS, OWNER_KEY, SNAPSHOT_PREFIX };
});
