/**
 * Database 数据存储类
 * 
 * Redis 的核心数据存储实现，支持5种数据类型：
 * 1. String（字符串）：最基础的键值对存储
 * 2. Hash（哈希表）：field-value 映射，适合存储对象
 * 3. List（列表）：双向列表，支持头部/尾部操作
 * 4. Set（集合）：无序集合，元素唯一
 * 5. ZSet（有序集合）：带分数的有序集合
 * 
 * 数据结构设计：
 * - 每种类型使用独立的 Map 存储
 * - entry 对象包含 value 和可选的 _expiry（过期时间戳）
 * - 支持惰性过期：访问时检查过期状态
 * 
 * 线程安全说明：
 * - JavaScript 单线程执行，无需考虑并发
 * - Java 版本使用 ConcurrentHashMap 保证线程安全
 */
class Database {
  constructor(index) {
    this.index = index; // 数据库索引（Redis 支持 0-15 共16个数据库）
    
    // 5种数据类型的存储容器
    this.strings = new Map(); // String 类型：Map<key, entry>
    this.hashes = new Map(); // Hash 类型：Map<key, entry<Map<field, value>>>
    this.lists = new Map(); // List 类型：Map<key, entry<Array>>
    this.sets = new Map(); // Set 类型：Map<key, entry<Set>>
    this.zsets = new Map(); // ZSet 类型：Map<key, entry<Map<member, score>>>
  }

  /**
   * 包装值：创建带过期时间的 entry 对象
   * 
   * @param value - 实际存储的值
   * @param ttlMs - 过期时间（毫秒），0 表示永不过期
   * @returns entry 对象 {value, _expiry}
   * 
   * 设计原理：
   * - _expiry 存储绝对过期时间戳（Date.now() + ttlMs）
   * - 便于过期检查：直接比较 Date.now() >= _expiry
   */
  _wrapValue(value, ttlMs) {
    const entry = { value };
    if (ttlMs && ttlMs > 0) {
      entry._expiry = Date.now() + ttlMs; // 计算绝对过期时间
    }
    return entry;
  }

  /**
   * 解包 entry：检查过期并返回值
   * 
   * @param entry - entry 对象
   * @returns 值或 undefined（已过期或不存在）
   * 
   * 惰性过期策略：
   * - 访问时才检查过期，而不是定时主动删除
   * - 减少定时清理开销，但可能导致过期键占用内存
   * - 结合 ExpiryManager 定期扫描清理，平衡性能和内存
   */
  _unwrapEntry(entry) {
    if (!entry) return undefined;
    if (entry._expiry && Date.now() >= entry._expiry) {
      return undefined; // 已过期
    }
    return entry.value; // 返回实际值
  }

  // ==================== String 操作 ====================
  
  /**
   * SET 命令实现：设置字符串键值对
   * 
   * @param key - 键名
   * @param value - 值
   * @param ttlMs - 过期时间（毫秒），0 表示永不过期
   * 
   * 实现细节：
   * - 使用 Map.set() 存储，会覆盖已存在的键
   * - 通过 _wrapValue 包装值，支持过期时间
   */
  setString(key, value, ttlMs) {
    this.strings.set(key, this._wrapValue(value, ttlMs));
  }

  /**
   * GET 命令实现：获取字符串值
   * 
   * @param key - 键名
   * @returns 值或 undefined（键不存在或已过期）
   * 
   * 过期处理：
   * - 如果键已过期，自动删除并返回 undefined
   * - 惰性删除：只在访问时检查过期
   */
  getString(key) {
    const entry = this.strings.get(key);
    const val = this._unwrapEntry(entry);
    if (val === undefined && entry !== undefined) {
      this.strings.delete(key); // 惰性删除过期键
    }
    return val;
  }

  /**
   * 删除字符串键
   * 
   * @param key - 键名
   * @returns 是否删除成功（true/false）
   */
  delString(key) {
    return this.strings.delete(key);
  }

  /**
   * EXISTS 命令实现：检查键是否存在
   * 
   * @param key - 键名
   * @returns 是否存在（true/false）
   * 
   * 过期检查：
   * - 如果键已过期，惰性删除并返回 false
   */
  existsKey(key) {
    const entry = this.strings.get(key);
    if (entry && entry._expiry && Date.now() >= entry._expiry) {
      this.strings.delete(key); // 惰性删除过期键
      return false;
    }
    return this.strings.has(key);
  }

  /**
   * EXPIRE 命令实现：设置键的过期时间
   * 
   * @param key - 键名
   * @param ttlMs - 过期时间（毫秒）
   * @returns 是否成功（1: 成功, 0: 键不存在）
   */
  expireKey(key, ttlMs) {
    const entry = this.strings.get(key);
    if (!entry) return 0; // 键不存在
    entry._expiry = Date.now() + ttlMs; // 更新过期时间
    return 1;
  }

  // ==================== Hash 操作 ====================
  
  /**
   * HSET 命令实现：设置哈希表字段值
   * 
   * @param key - 哈希表键名
   * @param field - 字段名
   * @param value - 字段值
   * 
   * 数据结构：
   * - hashes: Map<key, entry<Map<field, value>>>
   * - 如果哈希表不存在，自动创建
   * - entry 包装器支持过期时间
   */
  setHashField(key, field, value) {
    let hash = this.hashes.get(key);
    if (!hash) {
      const entry = { value: new Map() }; // 创建新的哈希表
      this.hashes.set(key, entry);
      hash = entry;
    }
    hash.value.set(field, value); // 设置字段值
  }

  /**
   * 批量设置哈希表字段
   * 
   * @param key - 哈希表键名
   * @param fields - Map<field, value> 或可迭代的键值对
   * 
   * 注意：会覆盖整个哈希表，而不是追加字段
   */
  setHashFields(key, fields) {
    const entry = this.hashes.get(key) || { value: new Map() };
    entry.value = new Map(fields); // 替换整个哈希表
    this.hashes.set(key, entry);
  }

  /**
   * HGET 命令实现：获取哈希表字段值
   * 
   * @param key - 哈希表键名
   * @param field - 字段名
   * @returns 字段值或 null（不存在）
   */
  getHashField(key, field) {
    const entry = this.hashes.get(key);
    if (!entry) return null; // 哈希表不存在
    if (entry._expiry && Date.now() >= entry._expiry) { 
      this.hashes.delete(key); // 惰性删除过期键
      return null; 
    }
    const val = entry.value.get(field);
    return val === undefined ? null : val; // 字段不存在返回 null
  }

  /**
   * HGETALL 命令实现：获取整个哈希表
   * 
   * @param key - 哈希表键名
   * @returns Map<field, value>（副本）
   * 
   * 返回副本的原因：
   * - 防止外部修改内部数据结构
   * - 保证数据一致性
   */
  getHashAll(key) {
    const entry = this.hashes.get(key);
    if (!entry) return new Map(); // 返回空 Map
    if (entry._expiry && Date.now() >= entry._expiry) { 
      this.hashes.delete(key); 
      return new Map(); 
    }
    return new Map(entry.value); // 返回副本
  }

  /**
   * HDEL 命令实现：删除哈希表字段
   * 
   * @param key - 哈希表键名
   * @param field - 字段名
   * @returns 是否删除成功（1: 成功, 0: 不存在）
   * 
   * 自动清理：
   * - 如果删除字段后哈希表为空，自动删除整个哈希表
   * - 减少内存占用
   */
  delHashField(key, field) {
    const entry = this.hashes.get(key);
    if (!entry) return 0;
    const deleted = entry.value.delete(field);
    if (entry.value.size === 0) this.hashes.delete(key); // 自动清理空哈希表
    return deleted ? 1 : 0;
  }

  /**
   * HMGET 命令实现：批量获取多个字段值
   * 
   * @param key - 哈希表键名
   * @param fields - 字段名数组
   * @returns 值数组（不存在的字段返回 null）
   */
  getMultiHashFields(key, fields) {
    const entry = this.hashes.get(key);
    if (!entry) return fields.map(() => null); // 全部返回 null
    if (entry._expiry && Date.now() >= entry._expiry) { 
      this.hashes.delete(key); 
      return fields.map(() => null); 
    }
    return fields.map(f => {
      const v = entry.value.get(f);
      return v === undefined ? null : v;
    });
  }

  /**
   * 检查哈希表是否存在
   * 
   * @param key - 哈希表键名
   * @returns 是否存在
   */
  hashExists(key) {
    const entry = this.hashes.get(key);
    if (!entry) return false;
    if (entry._expiry && Date.now() >= entry._expiry) { 
      this.hashes.delete(key); 
      return false; 
    }
    return true;
  }

  // ==================== List 操作 ====================
  
  /**
   * LPUSH 命令实现：从列表头部插入元素
   * 
   * @param key - 列表键名
   * @param values - 要插入的值数组
   * @returns 列表长度
   * 
   * 实现细节：
   * - 使用 Array.unshift() 在头部插入
   * - 多个值时，按顺序插入（最后插入的在最前面）
   * - 例如：LPUSH mylist a b c -> [c, b, a, ...]
   */
  listLPush(key, values) {
    let entry = this.lists.get(key);
    if (!entry) {
      entry = { value: [] }; // 创建空列表
      this.lists.set(key, entry);
    }
    for (const v of values) {
      entry.value.unshift(v); // 头部插入
    }
    return entry.value.length;
  }

  /**
   * RPUSH 命令实现：从列表尾部插入元素
   * 
   * @param key - 列表键名
   * @param values - 要插入的值数组
   * @returns 列表长度
   * 
   * 实现细节：
   * - 使用 Array.push() 在尾部插入
   * - 多个值时，按顺序追加
   * - 例如：RPUSH mylist a b c -> [..., a, b, c]
   */
  listRPush(key, values) {
    let entry = this.lists.get(key);
    if (!entry) {
      entry = { value: [] };
      this.lists.set(key, entry);
    }
    entry.value.push(...values); // 尾部批量插入
    return entry.value.length;
  }

  /**
   * LPOP 命令实现：弹出列表头部元素
   * 
   * @param key - 列表键名
   * @returns 头部元素或 null（列表为空）
   */
  listLPop(key) {
    const entry = this.lists.get(key);
    if (!entry || entry.value.length === 0) return null;
    return entry.value.shift(); // 移除并返回头部元素
  }

  /**
   * RPOP 命令实现：弹出列表尾部元素
   * 
   * @param key - 列表键名
   * @returns 尾部元素或 null（列表为空）
   */
  listRPop(key) {
    const entry = this.lists.get(key);
    if (!entry || entry.value.length === 0) return null;
    return entry.value.pop(); // 移除并返回尾部元素
  }

  /**
   * LLEN 命令实现：获取列表长度
   * 
   * @param key - 列表键名
   * @returns 列表长度（0 表示不存在或为空）
   */
  listLen(key) {
    const entry = this.lists.get(key);
    return entry ? entry.value.length : 0;
  }

  /**
   * LRANGE 命令实现：获取列表范围内的元素
   * 
   * @param key - 列表键名
   * @param start - 起始索引（支持负数）
   * @param stop - 结束索引（支持负数）
   * @returns 元素数组
   * 
   * 索引规则：
   * - 正数索引：从 0 开始，0 表示第一个元素
   * - 负数索引：从末尾开始，-1 表示最后一个元素
   * - 超出范围自动调整：
   *   - start < 0 调整为 0
   *   - stop >= len 调整为 len-1
   *   - start > stop 返回空数组
   * 
   * 示例：
   * - LRANGE mylist 0 -1：返回整个列表
   * - LRANGE mylist -3 -1：返回最后3个元素
   */
  listRange(key, start, stop) {
    const entry = this.lists.get(key);
    if (!entry) return [];
    const len = entry.value.length;
    
    // 计算实际索引
    let s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    
    // 边界调整
    if (s < 0) s = 0;
    if (e >= len) e = len - 1;
    if (s > e) return []; // 无效范围
    
    return entry.value.slice(s, e + 1); // slice 不包含 end，所以要 +1
  }

  // ==================== Set 操作 ====================
  
  /**
   * SADD 命令实现：向集合添加元素
   * 
   * @param key - 集合键名
   * @param members - 要添加的元素数组
   * @returns 实际添加的元素数量（已存在的元素不计入）
   * 
   * 实现细节：
   * - 使用 Set.add() 添加元素，自动保证唯一性
   * - 统计实际添加数量（Set.has() 检查是否已存在）
   */
  setAdd(key, members) {
    let entry = this.sets.get(key);
    if (!entry) {
      entry = { value: new Set() }; // 创建空集合
      this.sets.set(key, entry);
    }
    let added = 0;
    for (const m of members) {
      if (!entry.value.has(m)) { // 检查是否已存在
        entry.value.add(m);
        added++; // 只统计新添加的元素
      }
    }
    return added;
  }

  /**
   * SREM 命令实现：从集合移除元素
   * 
   * @param key - 集合键名
   * @param members - 要移除的元素数组
   * @returns 实际移除的元素数量
   * 
   * 自动清理：
   * - 移除元素后如果集合为空，删除整个集合
   */
  setRemove(key, members) {
    const entry = this.sets.get(key);
    if (!entry) return 0; // 集合不存在
    let removed = 0;
    for (const m of members) {
      if (entry.value.delete(m)) removed++; // delete() 返回是否成功
    }
    if (entry.value.size === 0) this.sets.delete(key); // 自动清理空集合
    return removed;
  }

  /**
   * SISMEMBER 命令实现：检查元素是否在集合中
   * 
   * @param key - 集合键名
   * @param member - 要检查的元素
   * @returns 是否存在（1: 存在, 0: 不存在）
   */
  setIsMember(key, member) {
    const entry = this.sets.get(key);
    if (!entry) return 0;
    return entry.value.has(member) ? 1 : 0;
  }

  /**
   * SMEMBERS 命令实现：获取集合所有元素
   * 
   * @param key - 集合键名
   * @returns 元素数组（无序）
   */
  setMembers(key) {
    const entry = this.sets.get(key);
    if (!entry) return [];
    return [...entry.value]; // Set 转数组
  }

  // ==================== Sorted Set（ZSet）操作 ====================
  
  /**
   * ZADD 命令实现：向有序集合添加元素
   * 
   * @param key - 有序集合键名
   * @param scoreMembers - [{score, member}] 数组
   * @returns 实际添加的元素数量（更新的元素不计入）
   * 
   * 数据结构：
   * - zsets: Map<key, entry<Map<member, score>>>
   * - 内部使用 Map 存储成员和分数
   * - 排序在查询时动态计算，不预先排序
   * 
   * 实现细节：
   * - 如果成员已存在，更新分数（不计入 added）
   * - 如果成员不存在，添加成员并计入 added
   */
  zsetAdd(key, scoreMembers) {
    let entry = this.zsets.get(key);
    if (!entry) {
      entry = { value: new Map() }; // 创建空有序集合
      this.zsets.set(key, entry);
    }
    let added = 0;
    for (const { score, member } of scoreMembers) {
      if (!entry.value.has(member)) { added++; } // 新成员才计入
      entry.value.set(member, score); // 设置或更新分数
    }
    return added;
  }

  /**
   * ZSCORE 命令实现：获取成员的分数
   * 
   * @param key - 有序集合键名
   * @param member - 成员名
   * @returns 分数或 null（成员不存在）
   */
  zsetScore(key, member) {
    const entry = this.zsets.get(key);
    if (!entry) return null;
    const score = entry.value.get(member);
    return score === undefined ? null : score;
  }

  /**
   * ZRANGE 命令实现：按索引范围获取有序集合元素
   * 
   * @param key - 有序集合键名
   * @param start - 装始索引（支持负数）
   * @param stop - 结束索引（支持负数）
   * @param withScores - 是否返回分数
   * @returns 元素数组（可选包含分数）
   * 
   * 排序规则：
   * - 先按分数从小到大排序
   * - 分数相同时，按成员名字典序排序
   * 
   * 性能说明：
   * - 每次查询都重新排序（时间复杂度 O(n log n)）
   * - 生产环境应使用更高效的数据结构（如跳表）
   * 
   * 索引规则与 LRANGE 相同（支持负数）
   */
  zsetRange(key, start, stop, withScores) {
    const entry = this.zsets.get(key);
    if (!entry) return [];
    
    // 排序：分数升序，分数相同时按成员名字典序
    const sorted = [...entry.value.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1]; // 分数排序
      return a[0].localeCompare(b[0]); // 成员名字典序
    });
    
    const len = sorted.length;
    // 计算实际索引（支持负数）
    let s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    if (s < 0) s = 0;
    if (e >= len) e = len - 1;
    if (s > e) return [];
    
    const result = [];
    for (let i = s; i <= e; i++) {
      if (withScores) {
        result.push(sorted[i][0], String(sorted[i][1])); // 返回成员和分数
      } else {
        result.push(sorted[i][0]); // 只返回成员
      }
    }
    return result;
  }

  /**
   * ZRANGEBYSCORE 命令实现：按分数范围获取有序集合元素
   * 
   * @param key - 有序集合键名
   * @param min - 最小分数（'-inf' 表示无限小）
   * @param max - 最大分数（'+inf' 表示无限大）
   * @param withScores - 是否返回分数
   * @param offset - 偏移量（跳过多少个元素）
   * @param count - 返回数量限制
   * @returns 元素数组
   * 
   * 特殊分数：
   * - '-inf'：无限小，表示所有分数 >= min
   * - '+inf'：无限大，表示所有分数 <= max
   * 
   * 分页支持：
   * - offset 和 count 用于分页查询
   * - offset > 0 时跳过前 offset 个元素
   * - count > 0 时只返回前 count 个元素
   */
  zsetRangeByScore(key, min, max, withScores, offset, count) {
    const entry = this.zsets.get(key);
    if (!entry) return [];
    
    // 按分数过滤并排序
    const sorted = [...entry.value.entries()]
      .filter(([, score]) => {
        if (min === '-inf') return score <= max; // 无最小限制
        if (max === '+inf') return score >= min; // 无最大限制
        return score >= min && score <= max; // 范围过滤
      })
      .sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[0].localeCompare(b[0]);
      });
    
    // 分页处理
    let slice = sorted;
    if (offset > 0) slice = slice.slice(offset); // 跳过元素
    if (count > 0) slice = slice.slice(0, count); // 限制数量
    
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

  // ==================== Keys 操作 ====================
  
  /**
   * KEYS 命令实现：按模式查找键
   * 
   * @param pattern - 匹配模式（支持通配符）
   * @returns 匹配的键数组
   * 
   * 通配符规则：
   * - *：匹配任意字符序列
   * - ?：匹配单个字符
   * - []：匹配字符集合，如 [abc] 匹配 a、b、c
   * - \：转义字符
   * 
   * 示例：
   * - KEYS *：匹配所有键
   * - KEYS user:*：匹配以 user: 开头的键
   * - KEYS cache:?：匹配 cache:a、cache:b 等
   * 
   * 性能警告：
   * - KEYS 命令会扫描所有键，大数据量时很慢
   * - 生产环境建议使用 SCAN 命令
   */
  keysByPattern(pattern) {
    const results = new Set();
    // 合并所有类型的键
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

  /**
   * TYPE 命令实现：获取键的数据类型
   * 
   * @param key - 键名
   * @returns 类型名称（string, hash, list, set, zset, none）
   */
  keyType(key) {
    if (this.strings.has(key)) return 'string';
    if (this.hashes.has(key)) return 'hash';
    if (this.lists.has(key)) return 'list';
    if (this.sets.has(key)) return 'set';
    if (this.zsets.has(key)) return 'zset';
    return 'none'; // 键不存在
  }

  /**
   * 删除单个键
   * 
   * @param key - 键名
   * @returns 是否删除成功（1: 成功, 0: 不存在）
   * 
   * 实现细节：
   * - 尝试从所有5种类型中删除
   * - 只要任意一个类型删除成功就返回 1
   */
  deleteKey(key) {
    let deleted = 0;
    if (this.strings.delete(key)) deleted++;
    if (this.hashes.delete(key)) deleted++;
    if (this.lists.delete(key)) deleted++;
    if (this.sets.delete(key)) deleted++;
    if (this.zsets.delete(key)) deleted++;
    return deleted > 0 ? 1 : 0;
  }

  /**
   * 批量删除键
   * 
   * @param keys - 键名数组
   * @returns 实际删除的键数量
   */
  deleteKeys(keys) {
    let count = 0;
    for (const key of keys) {
      count += this.deleteKey(key);
    }
    return count;
  }

  /**
   * FLUSHDB 命令实现：清空数据库
   * 
   * 清空所有5种数据类型，释放内存
   */
  flushDb() {
    this.strings.clear();
    this.hashes.clear();
    this.lists.clear();
    this.sets.clear();
    this.zsets.clear();
  }
}

/**
 * 将 Redis KEYS 模式转换为正则表达式
 * 
 * @param pattern - Redis 模式字符串
 * @returns 正则表达式对象
 * 
 * 转换规则：
 * - * -> .*（匹配任意字符序列）
 * - ? -> .（匹配单个字符）
 * - [] -> []（字符集合，保持原样）
 * - 其他特殊字符需要转义：. + ^ $ | ( ) { }
 * - \ -> \\（转义字符本身需要转义）
 * 
 * 示例：
 * - user:* -> ^user:.*$
 * - cache:? -> ^cache:.$
 * - [abc] -> ^[abc]$
 */
function patternToRegex(pattern) {
  let regexStr = '^'; // 从开始匹配
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    switch (ch) {
      case '*': regexStr += '.*'; break; // 通配符 *
      case '?': regexStr += '.'; break; // 通配符 ?
      case '[': {
        // 处理字符集合 [...]
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== ']') j++;
        if (j < pattern.length) {
          regexStr += pattern.substring(i, j + 1); // 保持 [...]
          i = j; // 跳过字符集合
        } else {
          regexStr += '\\['; // 未闭合的 [，需要转义
        }
        break;
      }
      case '\\': regexStr += '\\\\'; break; // 转义字符
      // 其他正则特殊字符需要转义
      case '.': regexStr += '\\.'; break;
      case '+': regexStr += '\\+'; break;
      case '^': regexStr += '\\^'; break;
      case '$': regexStr += '\\$'; break;
      case '|': regexStr += '\\|'; break;
      case '(': regexStr += '\\('; break;
      case ')': regexStr += '\\)'; break;
      case '{': regexStr += '\\{'; break;
      case '}': regexStr += '\\}'; break;
      default: regexStr += ch; // 普通字符
    }
  }
  regexStr += '$'; // 到结尾匹配
  return new RegExp(regexStr);
}

module.exports = { Database, patternToRegex };
