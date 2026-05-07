package cn.linnin.linredis.store;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Database 数据存储类（Java 实现）
 * 
 * Redis 的核心数据存储，支持5种数据类型：
 * 1. String（字符串）：最基础的键值对存储
 * 2. Hash（哈希表）：field-value 映射，适合存储对象
 * 3. List（列表）：双向列表，支持头部/尾部操作
 * 4. Set（集合）：无序集合，元素唯一
 * 5. ZSet（有序集合）：带分数的有序集合
 * 
 * 线程安全设计：
 * - 使用 ConcurrentHashMap 保证线程安全
 * - 支持多线程并发访问和修改
 * - 与 JavaScript 版本（单线程）的区别：需要考虑并发
 * 
 * 数据结构设计：
 * - 每种类型使用独立的 ConcurrentHashMap 存储
 * - StringEntry 类封装值和过期时间
 * - 支持惰性过期：访问时检查过期状态
 * 
 * 性能考虑：
 * - ConcurrentHashMap 提供高效的并发读写
 * - 使用 computeIfAbsent 保证原子性操作
 */
public class Database {
    public final int index; // 数据库索引（Redis 支持 0-15 共16个数据库）

    // 5种数据类型的存储容器（线程安全）
    public final ConcurrentHashMap<String, StringEntry> strings = new ConcurrentHashMap<>(); // String 类型
    public final ConcurrentHashMap<String, Map<String, String>> hashes = new ConcurrentHashMap<>(); // Hash 类型
    public final ConcurrentHashMap<String, List<String>> lists = new ConcurrentHashMap<>(); // List 类型
    public final ConcurrentHashMap<String, Set<String>> sets = new ConcurrentHashMap<>(); // Set 类型
    public final ConcurrentHashMap<String, Map<String, Double>> zsets = new ConcurrentHashMap<>(); // ZSet 类型

    /**
     * 创建数据库实例
     * 
     * @param index - 数据库索引
     */
    public Database(int index) {
        this.index = index;
    }

    /**
     * StringEntry - 字符串键值对包装类
     * 
     * 包含字符串值和过期时间：
     * - value：存储的字符串值
     * - expiry：过期时间戳（0 表示永不过期）
     * 
     * 过期机制：
     * - expiry > 0 时表示有过期时间
     * - isExpired() 方法检查是否过期
     * - 惰性过期：访问时检查，定时器定期清理
     */
    public static class StringEntry {
        public String value; // 字符串值
        public long expiry; // 过期时间戳（毫秒），0 表示永不过期

        /**
         * 创建字符串条目
         * 
         * @param value - 字符串值
         * @param ttlMs - 过期时间（毫秒），0 表示永不过期
         */
        public StringEntry(String value, long ttlMs) {
            this.value = value;
            this.expiry = ttlMs > 0 ? System.currentTimeMillis() + ttlMs : 0;
        }

        /**
         * 检查是否已过期
         * 
         * @return 是否过期
         */
        public boolean isExpired() {
            return expiry > 0 && System.currentTimeMillis() >= expiry;
        }
    }

    // ==================== String 操作 ====================
    
    /**
     * SET 命令实现：设置字符串键值对
     * 
     * @param key - 键名
     * @param value - 值
     * @param ttlMs - 过期时间（毫秒），0 表示永不过期
     * 
     * 线程安全：
     * - ConcurrentHashMap.put() 是原子操作
     */
    public void setString(String key, String value, long ttlMs) {
        strings.put(key, new StringEntry(value, ttlMs));
    }

    /**
     * GET 命令实现：获取字符串值
     * 
     * @param key - 键名
     * @return 值或 null（键不存在或已过期）
     * 
     * 过期处理：
     * - 如果键已过期，惰性删除并返回 null
     */
    public String getString(String key) {
        StringEntry entry = strings.get(key);
        if (entry == null) return null;
        if (entry.isExpired()) {
            strings.remove(key); // 惰性删除过期键
            return null;
        }
        return entry.value;
    }

    /**
     * 删除字符串键
     * 
     * @param key - 键名
     * @return 是否删除成功（1: 成功, 0: 不存在）
     */
    public int delString(String key) {
        return strings.remove(key) != null ? 1 : 0;
    }

    /**
     * EXISTS 命令实现：检查键是否存在
     * 
     * @param key - 键名
     * @return 是否存在
     */
    public boolean existsKey(String key) {
        StringEntry entry = strings.get(key);
        if (entry == null) return false;
        if (entry.isExpired()) {
            strings.remove(key); // 惰性删除
            return false;
        }
        return true;
    }

    /**
     * EXPIRE 命令实现：设置键的过期时间
     * 
     * @param key - 键名
     * @param ttlMs - 过期时间（毫秒）
     * @return 是否成功（1: 成功, 0: 键不存在）
     */
    public int expireKey(String key, long ttlMs) {
        StringEntry entry = strings.get(key);
        if (entry == null) return 0;
        entry.expiry = System.currentTimeMillis() + ttlMs;
        return 1;
    }

    /**
     * INCRBY 命令实现：递增整数
     * 
     * @param key - 键名
     * @param increment - 递增量（负数表示递减）
     * @return 递增后的值
     * 
     * 线程安全：
     * - getString 和 setString 分别是原子操作
     * - 但整个 INCRBY 不是原子操作（需要外部同步）
     * - 生产环境应使用原子类或同步机制
     */
    public int incrby(String key, long increment) {
        String val = getString(key);
        long num = (val == null ? 0 : Long.parseLong(val)) + increment;
        setString(key, String.valueOf(num), 0);
        return (int) num;
    }

    // ==================== Hash 操作 ====================
    
    /**
     * HSET 命令实现：设置哈希表字段值
     * 
     * @param key - 哈希表键名
     * @param field - 字段名
     * @param value - 字段值
     * 
     * 线程安全：
     * - computeIfAbsent 保证原子性：不存在时才创建
     * - put 操作是原子性的
     */
    public void hset(String key, String field, String value) {
        hashes.computeIfAbsent(key, k -> new ConcurrentHashMap<>()).put(field, value);
    }

    /**
     * HSETNX 命令实现：仅在字段不存在时设置
     * 
     * @param key - 哈希表键名
     * @param field - 字段名
     * @param value - 字段值
     * @return 是否设置成功（1: 成功, 0: 字段已存在）
     */
    public int hsetnx(String key, String field, String value) {
        Map<String, String> hash = hashes.computeIfAbsent(key, k -> new ConcurrentHashMap<>());
        if (hash.containsKey(field)) return 0; // 字段已存在
        hash.put(field, value);
        return 1;
    }

    /**
     * HGET 命令实现：获取哈希表字段值
     * 
     * @param key - 哈希表键名
     * @param field - 字段名
     * @return 字段值或 null
     */
    public String hget(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return null;
        return hash.get(field);
    }

    /**
     * HGETALL 命令实现：获取整个哈希表
     * 
     * @param key - 哈希表键名
     * @return Map<field, value>（副本）
     */
    public Map<String, String> hgetall(String key) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return new LinkedHashMap<>();
        return new LinkedHashMap<>(hash); // 返回副本
    }

    /**
     * HDEL 命令实现：删除哈希表字段
     * 
     * @param key - 哈希表键名
     * @param field - 字段名
     * @return 是否删除成功
     * 
     * 自动清理：
     * - 删除字段后如果哈希表为空，删除整个哈希表
     */
    public int hdel(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return 0;
        int result = hash.remove(field) != null ? 1 : 0;
        if (hash.isEmpty()) hashes.remove(key); // 自动清理
        return result;
    }

    /**
     * HMGET 命令实现：批量获取多个字段值
     * 
     * @param key - 哈希表键名
     * @param fields - 字段名列表
     * @return 值列表（不存在的字段返回 null）
     */
    public List<String> hmget(String key, List<String> fields) {
        Map<String, String> hash = hashes.get(key);
        List<String> result = new ArrayList<>();
        if (hash == null) {
            for (int i = 0; i < fields.size(); i++) result.add(null);
            return result;
        }
        for (String f : fields) result.add(hash.get(f));
        return result;
    }

    /**
     * HEXISTS 命令实现：检查字段是否存在
     * 
     * @param key - 哈希表键名
     * @param field - 字段名
     * @return 是否存在（1: 存在, 0: 不存在）
     */
    public int hexists(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return 0;
        return hash.containsKey(field) ? 1 : 0;
    }

    /**
     * HLEN 命令实现：获取哈希表字段数量
     * 
     * @param key - 哈希表键名
     * @return 字段数量
     */
    public int hlen(String key) {
        Map<String, String> hash = hashes.get(key);
        return hash == null ? 0 : hash.size();
    }

    // ==================== List 操作 ====================
    
    /**
     * LPUSH 命令实现：从列表头部插入元素
     * 
     * @param key - 列表键名
     * @param values - 要插入的值列表
     * @return 列表长度
     * 
     * 实现细节：
     * - 使用 ArrayList.add(0, value) 在头部插入
     * - 多个值按顺序插入
     */
    public int lpush(String key, List<String> values) {
        List<String> list = lists.computeIfAbsent(key, k -> new ArrayList<>());
        for (int i = 0; i < values.size(); i++) {
            list.add(0, values.get(i)); // 头部插入
        }
        return list.size();
    }

    /**
     * RPUSH 命令实现：从列表尾部插入元素
     * 
     * @param key - 列表键名
     * @param values - 要插入的值列表
     * @return 列表长度
     */
    public int rpush(String key, List<String> values) {
        List<String> list = lists.computeIfAbsent(key, k -> new ArrayList<>());
        list.addAll(values); // 尾部批量插入
        return list.size();
    }

    /**
     * LPOP 命令实现：弹出列表头部元素
     * 
     * @param key - 列表键名
     * @return 头部元素或 null
     */
    public String lpop(String key) {
        List<String> list = lists.get(key);
        if (list == null || list.isEmpty()) return null;
        return list.remove(0); // 移除并返回头部元素
    }

    /**
     * RPOP 命令实现：弹出列表尾部元素
     * 
     * @param key - 列表键名
     * @return 尾部元素或 null
     */
    public String rpop(String key) {
        List<String> list = lists.get(key);
        if (list == null || list.isEmpty()) return null;
        return list.remove(list.size() - 1); // 移除并返回尾部元素
    }

    /**
     * LLEN 命令实现：获取列表长度
     * 
     * @param key - 列表键名
     * @return 列表长度
     */
    public int llen(String key) {
        List<String> list = lists.get(key);
        return list == null ? 0 : list.size();
    }

    /**
     * LRANGE 命令实现：获取列表范围内的元素
     * 
     * @param key - 列表键名
     * @param start - 装始索引（支持负数）
     * @param stop - 结束索引（支持负数）
     * @return 元素列表
     * 
     * 索引规则与 JavaScript 版本相同（支持负数）
     */
    public List<String> lrange(String key, int start, int stop) {
        List<String> list = lists.get(key);
        if (list == null) return Collections.emptyList();
        
        int len = list.size();
        int s = start < 0 ? Math.max(0, len + start) : start;
        int e = stop < 0 ? len + stop : stop;
        if (s < 0) s = 0;
        if (e >= len) e = len - 1;
        if (s > e) return Collections.emptyList();
        
        return new ArrayList<>(list.subList(s, e + 1));
    }

    // ==================== Set 操作 ====================
    
    /**
     * SADD 命令实现：向集合添加元素
     * 
     * @param key - 集合键名
     * @param members - 要添加的元素列表
     * @return 实际添加的元素数量
     */
    public int sadd(String key, List<String> members) {
        Set<String> set = sets.computeIfAbsent(key, k -> ConcurrentHashMap.newKeySet());
        int added = 0;
        for (String m : members) {
            if (set.add(m)) added++; // Set.add() 返回是否成功
        }
        return added;
    }

    /**
     * SREM 命令实现：从集合移除元素
     * 
     * @param key - 集合键名
     * @param members - 要移除的元素列表
     * @return 实际移除的元素数量
     */
    public int srem(String key, List<String> members) {
        Set<String> set = sets.get(key);
        if (set == null) return 0;
        int removed = 0;
        for (String m : members) {
            if (set.remove(m)) removed++;
        }
        if (set.isEmpty()) sets.remove(key); // 自动清理
        return removed;
    }

    /**
     * SISMEMBER 命令实现：检查元素是否在集合中
     * 
     * @param key - 集合键名
     * @param member - 要检查的元素
     * @return 是否存在
     */
    public int sismember(String key, String member) {
        Set<String> set = sets.get(key);
        return (set != null && set.contains(member)) ? 1 : 0;
    }

    /**
     * SMEMBERS 命令实现：获取集合所有元素
     * 
     * @param key - 集合键名
     * @return 元素集合
     */
    public Set<String> smembers(String key) {
        Set<String> set = sets.get(key);
        if (set == null) return Collections.emptySet();
        return new LinkedHashSet<>(set); // 返回副本
    }

    // ZSet ops
    public int zadd(String key, List<ZMember> members) {
        Map<String, Double> zset = zsets.computeIfAbsent(key, k -> new ConcurrentHashMap<>());
        int added = 0;
        for (ZMember m : members) {
            if (!zset.containsKey(m.member)) added++;
            zset.put(m.member, m.score);
        }
        return added;
    }

    public Double zscore(String key, String member) {
        Map<String, Double> zset = zsets.get(key);
        if (zset == null) return null;
        return zset.get(member);
    }

    public List<Object> zrange(String key, int start, int stop, boolean withScores) {
        Map<String, Double> zset = zsets.get(key);
        if (zset == null) return Collections.emptyList();
        List<Map.Entry<String, Double>> sorted = new ArrayList<>(zset.entrySet());
        sorted.sort((a, b) -> {
            int cmp = Double.compare(a.getValue(), b.getValue());
            return cmp != 0 ? cmp : a.getKey().compareTo(b.getKey());
        });
        int len = sorted.size();
        int s = start < 0 ? Math.max(0, len + start) : start;
        int e = stop < 0 ? len + stop : stop;
        if (s < 0) s = 0;
        if (e >= len) e = len - 1;
        List<Object> result = new ArrayList<>();
        for (int i = s; i <= e; i++) {
            result.add(sorted.get(i).getKey());
            if (withScores) result.add(String.valueOf(sorted.get(i).getValue()));
        }
        return result;
    }

    public List<Object> zrangeByScore(String key, double min, double max, boolean withScores, int offset, int count) {
        Map<String, Double> zset = zsets.get(key);
        if (zset == null) return Collections.emptyList();
        List<Map.Entry<String, Double>> sorted = new ArrayList<>(zset.entrySet());
        sorted.removeIf(e -> e.getValue() < min || e.getValue() > max);
        sorted.sort((a, b) -> {
            int cmp = Double.compare(a.getValue(), b.getValue());
            return cmp != 0 ? cmp : a.getKey().compareTo(b.getKey());
        });
        if (offset > 0) sorted = sorted.subList(Math.min(offset, sorted.size()), sorted.size());
        if (count > 0 && count < sorted.size()) sorted = sorted.subList(0, count);
        List<Object> result = new ArrayList<>();
        for (Map.Entry<String, Double> entry : sorted) {
            result.add(entry.getKey());
            if (withScores) result.add(String.valueOf(entry.getValue()));
        }
        return result;
    }

    public int zrem(String key, List<String> members) {
        Map<String, Double> zset = zsets.get(key);
        if (zset == null) return 0;
        int removed = 0;
        for (String m : members) {
            if (zset.remove(m) != null) removed++;
        }
        if (zset.isEmpty()) zsets.remove(key);
        return removed;
    }

    // ==================== Keys 操作 ====================
    
    /**
     * KEYS 命令实现：按模式查找键
     * 
     * @param pattern - 匹配模式（Redis 通配符）
     * @return 匹配的键列表
     * 
     * 通配符规则与 JavaScript 版本相同
     */
    public List<String> keysByPattern(String pattern) {
        Pattern regex = patternToRegex(pattern);
        
        // 合并所有类型的键
        Set<String> allKeys = new LinkedHashSet<>();
        allKeys.addAll(strings.keySet());
        allKeys.addAll(hashes.keySet());
        allKeys.addAll(lists.keySet());
        allKeys.addAll(sets.keySet());
        allKeys.addAll(zsets.keySet());
        
        // 匹配模式
        List<String> result = new ArrayList<>();
        for (String key : allKeys) {
            if (regex.matcher(key).matches()) result.add(key);
        }
        return result;
    }

    /**
     * 删除单个键
     * 
     * @param key - 键名
     * @return 是否删除成功
     */
    public int deleteKey(String key) {
        int deleted = 0;
        if (strings.remove(key) != null) deleted++;
        if (hashes.remove(key) != null) deleted++;
        if (lists.remove(key) != null) deleted++;
        if (sets.remove(key) != null) deleted++;
        if (zsets.remove(key) != null) deleted++;
        return deleted > 0 ? 1 : 0;
    }

    /**
     * 批量删除键
     * 
     * @param keys - 键列表
     * @return 实际删除的键数量
     */
    public int deleteKeys(List<String> keys) {
        int count = 0;
        for (String key : keys) count += deleteKey(key);
        return count;
    }

    /**
     * FLUSHDB 命令实现：清空数据库
     */
    public void flushDb() {
        strings.clear();
        hashes.clear();
        lists.clear();
        sets.clear();
        zsets.clear();
    }

    /**
     * 获取数据库键总数
     * 
     * @return 键数量
     */
    public int dbSize() {
        return strings.size() + hashes.size() + lists.size() + sets.size() + zsets.size();
    }

    /**
     * 将 Redis KEYS 模式转换为正则表达式
     * 
     * @param pattern - Redis 模式
     * @return Pattern 对象
     * 
     * 转换规则与 JavaScript 版本相同
     */
    private Pattern patternToRegex(String pattern) {
        StringBuilder sb = new StringBuilder("^");
        for (int i = 0; i < pattern.length(); i++) {
            char ch = pattern.charAt(i);
            switch (ch) {
                case '*': sb.append(".*"); break;
                case '?': sb.append('.'); break;
                case '[': {
                    int j = i + 1;
                    while (j < pattern.length() && pattern.charAt(j) != ']') j++;
                    if (j < pattern.length()) { sb.append(pattern, i, j + 1); i = j; }
                    else sb.append("\\[");
                    break;
                }
                case '\\': sb.append("\\\\"); break;
                case '.': sb.append("\\."); break;
                case '+': sb.append("\\+"); break;
                case '^': sb.append("\\^"); break;
                case '$': sb.append("\\$"); break;
                case '|': sb.append("\\|"); break;
                case '(': sb.append("\\("); break;
                case ')': sb.append("\\)"); break;
                case '{': sb.append("\\{"); break;
                case '}': sb.append("\\}"); break;
                default: sb.append(ch);
            }
        }
        sb.append('$');
        return Pattern.compile(sb.toString());
    }

    /**
     * ZMember - 有序集合成员包装类
     * 
     * 包含成员名和分数
     */
    public static class ZMember {
        public final double score; // 分数
        public final String member; // 成员名

        public ZMember(double score, String member) {
            this.score = score;
            this.member = member;
        }
    }
}
