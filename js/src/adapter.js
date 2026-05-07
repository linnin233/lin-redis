/**
 * LinRedisAdapter - Redis 客户端适配器（直接方法调用模式）
 * 
 * 实现与 redis npm 包相同的接口，但直接调用 Database 方法，
 * 无需 TCP/RESP 序列化，零网络开销。
 * 
 * 支持的命令：
 * - 字符串: set, get, setEx, mGet, mSet, incr, incrBy, decr, decrBy, append, getRange, strlen, getSet
 * - 键操作: del, exists, keys, expire, ttl, type, rename, randomKey
 * - 哈希: hSet, hGet, hGetAll, hExists, hDel, hKeys, hVals, hLen
 * - 列表: lPush, rPush, lPop, rPop, lLen, lRange, lTrim, lIndex, lInsert, lSet, lRem
 * - 集合: sAdd, sMembers, sRem, sIsMember, sCard, sInter, sInterStore, sUnion, sDiff, sRandMember, sPop
 * - 有序集合: zAdd, zScore, zRange, zRangeByScore, zCard, zRem, zIncrBy, zRank, zRemRangeByRank
 * - 数据库: flushDb, flushAll, select, dbsize, info, ping, echo
 * - 扫描: scan
 * 
 * @module adapter
 */
const { Database } = require('./store/database');

class LinRedisAdapter {
    constructor(options = {}) {
        this._dbIndex = options.database || 0; // 当前数据库索引
        this._dbs = new Map(); // 数据库实例缓存
        this._events = Object.create(null); // 事件回调
        this.isOpen = false; // 连接状态
    }

    // 确保指定索引的数据库实例存在
    _ensureDb(index) {
        if (!this._dbs.has(index)) {
            this._dbs.set(index, new Database(index));
        }
        return this._dbs.get(index);
    }

    // 获取当前数据库实例
    _db() {
        return this._ensureDb(this._dbIndex);
    }

    // ==================== 事件系统 ====================

    on(event, handler) {
        if (!this._events[event]) this._events[event] = [];
        this._events[event].push(handler);
        return this;
    }

    _emit(event, ...args) {
        const handlers = this._events[event];
        if (handlers) {
            for (const h of handlers) {
                try { h(...args); } catch (_) {}
            }
        }
    }

    // ==================== 连接生命周期 ====================

    async connect() {
        this.isOpen = true;
        this._emit('connect');
        this._emit('ready');
        return this;
    }

    async quit() {
        this.isOpen = false;
        this._emit('end');
        return 'OK';
    }

    async disconnect() {
        this.isOpen = false;
    }

    // ==================== 字符串操作 ====================

    async set(key, value) {
        this._db().setString(key, String(value), 0);
        return 'OK';
    }

    async setEx(key, seconds, value) {
        this._db().setString(key, String(value), seconds * 1000);
        return 'OK';
    }

    async get(key) {
        return this._db().getString(key) ?? null;
    }

    async mGet(keys) {
        const db = this._db();
        return keys.map(k => db.getString(k) ?? null);
    }

    // ==================== 键操作 ====================

    async del(keys) {
        return this._db().deleteKeys(Array.isArray(keys) ? keys : [keys]);
    }

    async exists(key) {
        const db = this._db();
        if (db.strings.has(key)) return 1;
        if (db.hashes.has(key)) return 1;
        if (db.lists.has(key)) return 1;
        if (db.sets.has(key)) return 1;
        if (db.zsets.has(key)) return 1;
        return 0;
    }

    async keys(pattern) {
        return this._db().keysByPattern(pattern);
    }

    async expire(key, seconds) {
        return this._db().expireKey(key, seconds * 1000);
    }

    async ttl(key) {
        const db = this._db();
        const entry = db.strings.get(key);
        if (!entry || !entry._expiry) return -1;
        const remaining = entry._expiry - Date.now();
        if (remaining <= 0) {
            db.strings.delete(key);
            return -2;
        }
        return Math.floor(remaining / 1000);
    }

    async type(key) {
        return this._db().keyType(key);
    }

    // ==================== 扫描操作 ====================

    async scan(cursor, options = {}) {
        const db = this._db();
        const pattern = options.MATCH || '*';
        const count = options.COUNT || 10;

        const allKeys = db.keysByPattern(pattern);

        const startIdx = cursor;
        const slice = allKeys.slice(startIdx, startIdx + count);
        const newCursor = (startIdx + count >= allKeys.length) ? 0 : startIdx + count;

        return { cursor: newCursor, keys: slice };
    }

    // ==================== 哈希操作 ====================

    async hSet(key, field, value) {
        const db = this._db();
        const wasNew = db.getHashField(key, field) === null;
        db.setHashField(key, field, String(value));
        return wasNew ? 1 : 0;
    }

    async hGet(key, field) {
        return this._db().getHashField(key, field);
    }

    async hGetAll(key) {
        const map = this._db().getHashAll(key);
        const obj = Object.create(null);
        for (const [k, v] of map) {
            obj[k] = v;
        }
        return obj;
    }

    async hExists(key, field) {
        return this._db().getHashField(key, field) !== null;
    }

    async hDel(key, field) {
        return this._db().delHashField(key, field);
    }

    async hKeys(key) {
        const map = this._db().getHashAll(key);
        return [...map.keys()];
    }

    async hVals(key) {
        const map = this._db().getHashAll(key);
        return [...map.values()];
    }

    async hLen(key) {
        return this._db().getHashAll(key).size;
    }

    // ==================== 列表操作 ====================

    async lPush(key, values) {
        const arr = Array.isArray(values) ? values : [values];
        return this._db().listLPush(key, arr.map(String));
    }

    async rPush(key, values) {
        const arr = Array.isArray(values) ? values : [values];
        return this._db().listRPush(key, arr.map(String));
    }

    async lPop(key) {
        return this._db().listLPop(key);
    }

    async rPop(key) {
        return this._db().listRPop(key);
    }

    async lLen(key) {
        return this._db().listLen(key);
    }

    async lRange(key, start, stop) {
        return this._db().listRange(key, start, stop);
    }

    async lTrim(key, start, stop) {
        const db = this._db();
        const list = db.lists.get(key);
        if (!list) return 'OK';
        const trimmed = db.listRange(key, start, stop);
        list.value = trimmed;
        return 'OK';
    }

    async lIndex(key, index) {
        const items = this._db().listRange(key, index, index);
        return items.length > 0 ? items[0] : null;
    }

    async lInsert(key, position, pivot, value) {
        const db = this._db();
        const list = db.lists.get(key);
        if (!list) return 0;
        const idx = list.value.indexOf(String(pivot));
        if (idx === -1) return -1;
        if (position === 'BEFORE') {
            list.value.splice(idx, 0, String(value));
        } else {
            list.value.splice(idx + 1, 0, String(value));
        }
        return list.value.length;
    }

    async lSet(key, index, value) {
        const db = this._db();
        const list = db.lists.get(key);
        if (!list || index < 0 || index >= list.value.length) {
            throw new Error('ERR index out of range');
        }
        list.value[index] = String(value);
        return 'OK';
    }

    async lRem(key, count, value) {
        const db = this._db();
        const list = db.lists.get(key);
        if (!list) return 0;
        let removed = 0;
        const target = String(value);
        if (count === 0) {
            // remove all
            const newList = list.value.filter(v => v !== target);
            removed = list.value.length - newList.length;
            list.value = newList;
        } else if (count > 0) {
            // remove first `count` from left
            for (let i = 0; i < list.value.length && removed < count; ) {
                if (list.value[i] === target) {
                    list.value.splice(i, 1);
                    removed++;
                } else {
                    i++;
                }
            }
        } else {
            // remove last |count| from right
            const absCount = -count;
            for (let i = list.value.length - 1; i >= 0 && removed < absCount; i--) {
                if (list.value[i] === target) {
                    list.value.splice(i, 1);
                    removed++;
                }
            }
        }
        return removed;
    }

    // ==================== 集合操作 ====================

    async sAdd(key, members) {
        const arr = Array.isArray(members) ? members : [members];
        return this._db().setAdd(key, arr.map(String));
    }

    async sMembers(key) {
        return this._db().setMembers(key);
    }

    async sRem(key, members) {
        const arr = Array.isArray(members) ? members : [members];
        return this._db().setRemove(key, arr.map(String));
    }

    async sIsMember(key, member) {
        return this._db().setIsMember(key, String(member));
    }

    async sCard(key) {
        const db = this._db();
        const set = db.sets.get(key);
        return set ? set.value.size : 0;
    }

    async sInter(keys) {
        const db = this._db();
        const sets = keys.map(k => {
            const entry = db.sets.get(k);
            return entry ? entry.value : new Set();
        });
        if (sets.length === 0) return [];
        const result = sets[0];
        for (let i = 1; i < sets.length; i++) {
            for (const item of result) {
                if (!sets[i].has(item)) {
                    result.delete(item);
                }
            }
        }
        return [...result];
    }

    async sInterStore(destKey, keys) {
        const result = await this.sInter(keys);
        if (result.length > 0) {
            this._db().setAdd(destKey, result);
        }
        return result.length;
    }

    async sUnion(keys) {
        const db = this._db();
        const union = new Set();
        for (const k of keys) {
            const entry = db.sets.get(k);
            if (entry) {
                for (const v of entry.value) union.add(v);
            }
        }
        return [...union];
    }

    async sDiff(keys) {
        const db = this._db();
        if (keys.length === 0) return [];
        const first = db.sets.get(keys[0]);
        if (!first) return [];
        const result = new Set(first.value);
        for (let i = 1; i < keys.length; i++) {
            const other = db.sets.get(keys[i]);
            if (other) {
                for (const item of other.value) {
                    result.delete(item);
                }
            }
        }
        return [...result];
    }

    async sRandMember(key, count) {
        const members = this._db().setMembers(key);
        if (count === undefined) {
            if (members.length === 0) return null;
            return members[Math.floor(Math.random() * members.length)];
        }
        const result = [];
        const remaining = [...members];
        const n = Math.abs(count);
        for (let i = 0; i < n && remaining.length > 0; i++) {
            const idx = Math.floor(Math.random() * remaining.length);
            result.push(remaining[idx]);
            if (count > 0) remaining.splice(idx, 1);
        }
        return result;
    }

    async sPop(key, count) {
        const members = this._db().setMembers(key);
        if (members.length === 0) return count !== undefined ? [] : null;
        const n = count || 1;
        const result = [];
        const toRemove = [];
        const remaining = [...members];
        for (let i = 0; i < n && remaining.length > 0; i++) {
            const idx = Math.floor(Math.random() * remaining.length);
            result.push(remaining[idx]);
            toRemove.push(remaining[idx]);
            remaining.splice(idx, 1);
        }
        this._db().setRemove(key, toRemove);
        return count !== undefined ? result : result[0];
    }

    // ==================== Sorted Set 操作 ====================

    async zAdd(key, ...args) {
        const db = this._db();
        let scoreMembers = [];

        if (args.length >= 2 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
            // zAdd(key, {score, value})
            scoreMembers = [{ score: Number(args[0].score), member: String(args[0].value) }];
        } else if (args.length >= 2 && typeof args[0] === 'number' && typeof args[1] === 'string') {
            // zAdd(key, score, member)
            scoreMembers = [{ score: Number(args[0]), member: String(args[1]) }];
        } else if (Array.isArray(args[0])) {
            // zAdd(key, [{score, value}, ...])
            scoreMembers = args[0].map(s => ({
                score: Number(s.score),
                member: String(s.value ?? s.member)
            }));
        } else {
            scoreMembers = args.filter(a => typeof a === 'object' && a !== null).map(s => ({
                score: Number(s.score),
                member: String(s.value ?? s.member)
            }));
        }

        return db.zsetAdd(key, scoreMembers);
    }

    async zScore(key, member) {
        return this._db().zsetScore(key, String(member));
    }

    async zRange(key, start, stop, options) {
        const withScores = !!(options && options.withScores);
        return this._db().zsetRange(key, start, stop, withScores);
    }

    async zRangeByScore(key, min, max, options) {
        const withScores = !!(options && options.withScores);
        return this._db().zsetRangeByScore(key, min, max, withScores, 0, 0);
    }

    async zCard(key) {
        const db = this._db();
        const entry = db.zsets.get(key);
        return entry ? entry.value.size : 0;
    }

    async zRem(key, members) {
        const db = this._db();
        const entry = db.zsets.get(key);
        if (!entry) return 0;
        let removed = 0;
        const arr = Array.isArray(members) ? members : [members];
        for (const m of arr) {
            if (entry.value.delete(String(m))) removed++;
        }
        if (entry.value.size === 0) db.zsets.delete(key);
        return removed;
    }

    async zIncrBy(key, increment, member) {
        const db = this._db();
        const current = db.zsetScore(key, String(member));
        const newScore = (current !== null ? current : 0) + Number(increment);
        db.zsetAdd(key, [{ score: newScore, member: String(member) }]);
        return String(newScore);
    }

    async zRank(key, member) {
        const db = this._db();
        const entry = db.zsets.get(key);
        if (!entry) return null;
        const sorted = [...entry.value.entries()].sort((a, b) => {
            if (a[1] !== b[1]) return a[1] - b[1];
            return a[0].localeCompare(b[0]);
        });
        const idx = sorted.findIndex(([m]) => m === String(member));
        return idx >= 0 ? idx : null;
    }

    async zRangeWithScores(key, start, stop) {
        return this._db().zsetRange(key, start, stop, true);
    }

    async zRemRangeByRank(key, start, stop) {
        const db = this._db();
        const entry = db.zsets.get(key);
        if (!entry) return 0;
        const sorted = [...entry.value.entries()].sort((a, b) => {
            if (a[1] !== b[1]) return a[1] - b[1];
            return a[0].localeCompare(b[0]);
        });
        const len = sorted.length;
        let s = start < 0 ? Math.max(0, len + start) : start;
        let e = stop < 0 ? len + stop : stop;
        if (s < 0) s = 0;
        if (e >= len) e = len - 1;
        if (s > e) return 0;
        let removed = 0;
        for (let i = e; i >= s; i--) {
            entry.value.delete(sorted[i][0]);
            removed++;
        }
        return removed;
    }

    // ==================== 数据库操作 ====================

    async flushDb() {
        this._db().flushDb();
        return 'OK';
    }

    async flushAll() {
        for (const db of this._dbs.values()) {
            db.flushDb();
        }
        return 'OK';
    }

    async select(index) {
        this._dbIndex = Number(index);
        this._ensureDb(this._dbIndex);
        return 'OK';
    }

    async dbsize() {
        const db = this._db();
        return db.strings.size + db.hashes.size + db.lists.size + db.sets.size + db.zsets.size;
    }

    async info() {
        return '# Server\nlin_redis_version:1.0.0\nos:Node.js\n';
    }

    async ping(...args) {
        if (args.length === 0) return 'PONG';
        return args.length === 1 ? String(args[0]) : String(args);
    }

    async echo(message) {
        return String(message);
    }

    async randomKey() {
        const db = this._db();
        const allKeys = [
            ...db.strings.keys(),
            ...db.hashes.keys(),
            ...db.lists.keys(),
            ...db.sets.keys(),
            ...db.zsets.keys()
        ];
        if (allKeys.length === 0) return null;
        return allKeys[Math.floor(Math.random() * allKeys.length)];
    }

    async rename(key, newKey) {
        const db = this._db();
        // Try copying from each data type
        if (db.strings.has(key)) {
            db.strings.set(newKey, db.strings.get(key));
            db.strings.delete(key);
            return 'OK';
        }
        if (db.hashes.has(key)) {
            db.hashes.set(newKey, db.hashes.get(key));
            db.hashes.delete(key);
            return 'OK';
        }
        if (db.lists.has(key)) {
            db.lists.set(newKey, db.lists.get(key));
            db.lists.delete(key);
            return 'OK';
        }
        if (db.sets.has(key)) {
            db.sets.set(newKey, db.sets.get(key));
            db.sets.delete(key);
            return 'OK';
        }
        if (db.zsets.has(key)) {
            db.zsets.set(newKey, db.zsets.get(key));
            db.zsets.delete(key);
            return 'OK';
        }
        throw new Error('ERR no such key');
    }

    async incr(key) {
        const db = this._db();
        const val = db.getString(key);
        const num = (val !== undefined && val !== null) ? parseInt(val, 10) || 0 : 0;
        const newVal = num + 1;
        db.setString(key, String(newVal), 0);
        return newVal;
    }

    async incrBy(key, increment) {
        const db = this._db();
        const val = db.getString(key);
        const num = (val !== undefined && val !== null) ? parseInt(val, 10) || 0 : 0;
        const newVal = num + Number(increment);
        db.setString(key, String(newVal), 0);
        return newVal;
    }

    async decr(key) {
        const db = this._db();
        const val = db.getString(key);
        const num = (val !== undefined && val !== null) ? parseInt(val, 10) || 0 : 0;
        const newVal = num - 1;
        db.setString(key, String(newVal), 0);
        return newVal;
    }

    async decrBy(key, decrement) {
        const db = this._db();
        const val = db.getString(key);
        const num = (val !== undefined && val !== null) ? parseInt(val, 10) || 0 : 0;
        const newVal = num - Number(decrement);
        db.setString(key, String(newVal), 0);
        return newVal;
    }

    async append(key, value) {
        const db = this._db();
        const existing = db.getString(key) || '';
        const newVal = existing + String(value);
        db.setString(key, newVal, 0);
        return newVal.length;
    }

    async getRange(key, start, end) {
        const val = this._db().getString(key);
        if (!val) return '';
        const s = start < 0 ? Math.max(0, val.length + start) : start;
        const e = end < 0 ? val.length + end : end;
        if (s > e || s >= val.length) return '';
        return val.substring(s, e + 1);
    }

    async strlen(key) {
        const val = this._db().getString(key);
        return val ? val.length : 0;
    }

    async getSet(key, value) {
        const old = this._db().getString(key) ?? null;
        this._db().setString(key, String(value), 0);
        return old;
    }

    async mSet(keyValuePairs) {
        const db = this._db();
        if (Array.isArray(keyValuePairs)) {
            for (let i = 0; i < keyValuePairs.length; i += 2) {
                db.setString(keyValuePairs[i], String(keyValuePairs[i + 1] || ''), 0);
            }
        } else {
            for (const [k, v] of Object.entries(keyValuePairs)) {
                db.setString(k, String(v), 0);
            }
        }
        return 'OK';
    }
}

module.exports = { LinRedisAdapter };
