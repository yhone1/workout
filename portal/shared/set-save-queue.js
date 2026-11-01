// Writes for the same set must reach the server in input order.
export function createSetSaveQueue(write) {
  const entries = new Map();
  return {
    save(key, value) {
      const fingerprint = JSON.stringify(value);
      const previous = entries.get(key);
      if (previous?.fingerprint === fingerprint && !previous.error) return previous.promise;
      const entry = { fingerprint, error: null, promise: null };
      entry.promise = (previous?.promise || Promise.resolve()).catch(() => {}).then(() => write(key, value)).catch((error) => {
        entry.error = error;
        throw error;
      });
      entries.set(key, entry);
      // Callers may use fire-and-forget autosave; flush still observes failures.
      entry.promise.catch(() => {});
      return entry.promise;
    },
    isLatest(key, value) {
      return entries.get(key)?.fingerprint === JSON.stringify(value);
    },
    async flush() {
      let snapshot;
      do {
        snapshot = [...entries.values()];
        await Promise.all(snapshot.map((entry) => entry.promise));
      } while (snapshot.length !== entries.size || snapshot.some((entry) => ![...entries.values()].includes(entry)));
    },
  };
}
