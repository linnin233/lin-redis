class Database {
  constructor(index) {
    this.index = index;
    this.strings = new Map();
    this.hashes = new Map();
    this.lists = new Map();
    this.sets = new Map();
    this.zsets = new Map();
  }

  _wrapValue(value, ttlMs) {
    const entry = { value };
    if (ttlMs && ttlMs > 0) {
      entry._expiry = Date.now() + ttlMs;
    }
    return entry;
  }

  _unwrapEntry(entry) {
    if (!entry) return undefined;
    if (entry._expiry && Date.now() >= entry._expiry) {
      return undefined;
    }
    return entry.value;
  }

  // --- String ---
  setString(key, value, ttlMs) {
    this.strings.set(key, this._wrapValue(value, ttlMs));
  }

  getString(key) {
    const entry = this.strings.get(key);
    const val = this._unwrapEntry(entry);
    if (val === undefined && entry !== undefined) {
      this.strings.delete(key);
    }
    return val;
  }

  delString(key) {
    return this.strings.delete(key);
  }

  existsKey(key) {
    const entry = this.strings.get(key);
    if (entry && entry._expiry && Date.now() >= entry._expiry) {
      this.strings.delete(key);
      return false;
    }
    return this.strings.has(key);
  }

  expireKey(key, ttlMs) {
    const entry = this.strings.get(key);
    if (!entry) return 0;
    entry._expiry = Date.now() + ttlMs;
    return 1;
  }

  // --- Hash ---
  setHashField(key, field, value) {
    let hash = this.hashes.get(key);
    if (!hash) {
      const entry = { value: new Map() };
      this.hashes.set(key, entry);
      hash = entry;
    }
    hash.value.set(field, value);
  }

  setHashFields(key, fields) {
    const entry = this.hashes.get(key) || { value: new Map() };
    entry.value = new Map(fields);
    this.hashes.set(key, entry);
  }

  getHashField(key, field) {
    const entry = this.hashes.get(key);
    if (!entry) return null;
    if (entry._expiry && Date.now() >= entry._expiry) { this.hashes.delete(key); return null; }
    const val = entry.value.get(field);
    return val === undefined ? null : val;
  }

  getHashAll(key) {
    const entry = this.hashes.get(key);
    if (!entry) return new Map();
    if (entry._expiry && Date.now() >= entry._expiry) { this.hashes.delete(key); return new Map(); }
    return new Map(entry.value);
  }

  delHashField(key, field) {
    const entry = this.hashes.get(key);
    if (!entry) return 0;
    const deleted = entry.value.delete(field);
    if (entry.value.size === 0) this.hashes.delete(key);
    return deleted ? 1 : 0;
  }

  getMultiHashFields(key, fields) {
    const entry = this.hashes.get(key);
    if (!entry) return fields.map(() => null);
    if (entry._expiry && Date.now() >= entry._expiry) { this.hashes.delete(key); return fields.map(() => null); }
    return fields.map(f => {
      const v = entry.value.get(f);
      return v === undefined ? null : v;
    });
  }

  hashExists(key) {
    const entry = this.hashes.get(key);
    if (!entry) return false;
    if (entry._expiry && Date.now() >= entry._expiry) { this.hashes.delete(key); return false; }
    return true;
  }

  // --- List ---
  listLPush(key, values) {
    let entry = this.lists.get(key);
    if (!entry) {
      entry = { value: [] };
      this.lists.set(key, entry);
    }
    for (const v of values) {
      entry.value.unshift(v);
    }
    return entry.value.length;
  }

  listRPush(key, values) {
    let entry = this.lists.get(key);
    if (!entry) {
      entry = { value: [] };
      this.lists.set(key, entry);
    }
    entry.value.push(...values);
    return entry.value.length;
  }

  listLPop(key) {
    const entry = this.lists.get(key);
    if (!entry || entry.value.length === 0) return null;
    return entry.value.shift();
  }

  listRPop(key) {
    const entry = this.lists.get(key);
    if (!entry || entry.value.length === 0) return null;
    return entry.value.pop();
  }

  listLen(key) {
    const entry = this.lists.get(key);
    return entry ? entry.value.length : 0;
  }

  listRange(key, start, stop) {
    const entry = this.lists.get(key);
    if (!entry) return [];
    const len = entry.value.length;
    let s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    if (s < 0) s = 0;
    if (e >= len) e = len - 1;
    if (s > e) return [];
    return entry.value.slice(s, e + 1);
  }

  // --- Set ---
  setAdd(key, members) {
    let entry = this.sets.get(key);
    if (!entry) {
      entry = { value: new Set() };
      this.sets.set(key, entry);
    }
    let added = 0;
    for (const m of members) {
      if (!entry.value.has(m)) { entry.value.add(m); added++; }
    }
    return added;
  }

  setRemove(key, members) {
    const entry = this.sets.get(key);
    if (!entry) return 0;
    let removed = 0;
    for (const m of members) {
      if (entry.value.delete(m)) removed++;
    }
    if (entry.value.size === 0) this.sets.delete(key);
    return removed;
  }

  setIsMember(key, member) {
    const entry = this.sets.get(key);
    if (!entry) return 0;
    return entry.value.has(member) ? 1 : 0;
  }

  setMembers(key) {
    const entry = this.sets.get(key);
    if (!entry) return [];
    return [...entry.value];
  }

  // --- Sorted Set ---
  zsetAdd(key, scoreMembers) {
    let entry = this.zsets.get(key);
    if (!entry) {
      entry = { value: new Map() };
      this.zsets.set(key, entry);
    }
    let added = 0;
    for (const { score, member } of scoreMembers) {
      if (!entry.value.has(member)) { added++; }
      entry.value.set(member, score);
    }
    return added;
  }

  zsetScore(key, member) {
    const entry = this.zsets.get(key);
    if (!entry) return null;
    const score = entry.value.get(member);
    return score === undefined ? null : score;
  }

  zsetRange(key, start, stop, withScores) {
    const entry = this.zsets.get(key);
    if (!entry) return [];
    const sorted = [...entry.value.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[0].localeCompare(b[0]);
    });
    const len = sorted.length;
    let s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    if (s < 0) s = 0;
    if (e >= len) e = len - 1;
    if (s > e) return [];
    const result = [];
    for (let i = s; i <= e; i++) {
      if (withScores) {
        result.push(sorted[i][0], String(sorted[i][1]));
      } else {
        result.push(sorted[i][0]);
      }
    }
    return result;
  }

  zsetRangeByScore(key, min, max, withScores, offset, count) {
    const entry = this.zsets.get(key);
    if (!entry) return [];
    const sorted = [...entry.value.entries()]
      .filter(([, score]) => {
        if (min === '-inf') return score <= max;
        if (max === '+inf') return score >= min;
        return score >= min && score <= max;
      })
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[0].localeCompare(b[0]);
      });
    let slice = sorted;
    if (offset > 0) slice = slice.slice(offset);
    if (count > 0) slice = slice.slice(0, count);
    const result = [];
    for (const [member, score] of slice) {
      if (withScores) {
        result.push(member, String(score));
      } else {
        result.push(member);
      }
    }
    return result;
  }

  // --- Keys ---
  keysByPattern(pattern) {
    const results = new Set();
    const allKeys = new Set([
      ...this.strings.keys(),
      ...this.hashes.keys(),
      ...this.lists.keys(),
      ...this.sets.keys(),
      ...this.zsets.keys()
    ]);
    const regex = patternToRegex(pattern);
    for (const key of allKeys) {
      if (regex.test(key)) results.add(key);
    }
    return [...results];
  }

  keyType(key) {
    if (this.strings.has(key)) return 'string';
    if (this.hashes.has(key)) return 'hash';
    if (this.lists.has(key)) return 'list';
    if (this.sets.has(key)) return 'set';
    if (this.zsets.has(key)) return 'zset';
    return 'none';
  }

  deleteKey(key) {
    let deleted = 0;
    if (this.strings.delete(key)) deleted++;
    if (this.hashes.delete(key)) deleted++;
    if (this.lists.delete(key)) deleted++;
    if (this.sets.delete(key)) deleted++;
    if (this.zsets.delete(key)) deleted++;
    return deleted > 0 ? 1 : 0;
  }

  deleteKeys(keys) {
    let count = 0;
    for (const key of keys) {
      count += this.deleteKey(key);
    }
    return count;
  }

  flushDb() {
    this.strings.clear();
    this.hashes.clear();
    this.lists.clear();
    this.sets.clear();
    this.zsets.clear();
  }
}

function patternToRegex(pattern) {
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    switch (ch) {
      case '*': regexStr += '.*'; break;
      case '?': regexStr += '.'; break;
      case '[': {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== ']') j++;
        if (j < pattern.length) {
          regexStr += pattern.substring(i, j + 1);
          i = j;
        } else {
          regexStr += '\\[';
        }
        break;
      }
      case '\\': regexStr += '\\\\'; break;
      case '.': regexStr += '\\.'; break;
      case '+': regexStr += '\\+'; break;
      case '^': regexStr += '\\^'; break;
      case '$': regexStr += '\\$'; break;
      case '|': regexStr += '\\|'; break;
      case '(': regexStr += '\\('; break;
      case ')': regexStr += '\\)'; break;
      case '{': regexStr += '\\{'; break;
      case '}': regexStr += '\\}'; break;
      default: regexStr += ch;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}

module.exports = { Database, patternToRegex };
