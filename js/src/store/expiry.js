class ExpiryManager {
  constructor(databases, sweepIntervalMs = 100) {
    this.databases = databases;
    this.sweepIntervalMs = sweepIntervalMs;
    this.timer = null;
    this.stats = { expired: 0, sweeps: 0 };
  }

  start() {
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  sweep() {
    this.stats.sweeps++;
    for (const db of this.databases.values()) {
      for (const storeType of ['strings', 'hashes', 'lists', 'sets', 'zsets']) {
        const store = db[storeType];
        if (!store) continue;
        for (const [key, entry] of store) {
          if (this._isExpired(entry)) {
            store.delete(key);
            this.stats.expired++;
          }
        }
      }
    }
  }

  _isExpired(entry) {
    if (!entry || !entry._expiry) return false;
    return Date.now() >= entry._expiry;
  }

  isKeyExpired(key, db) {
    for (const storeType of ['strings', 'hashes', 'lists', 'sets', 'zsets']) {
      const store = db[storeType];
      if (store.has(key)) {
        const entry = store.get(key);
        if (this._isExpired(entry)) {
          store.delete(key);
          this.stats.expired++;
          return true;
        }
        return false;
      }
    }
    return false;
  }

  getStats() {
    return { ...this.stats };
  }
}

module.exports = { ExpiryManager };
