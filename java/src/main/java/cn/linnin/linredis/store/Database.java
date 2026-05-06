package cn.linnin.linredis.store;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

public class Database {
    public final int index;

    public final ConcurrentHashMap<String, StringEntry> strings = new ConcurrentHashMap<>();
    public final ConcurrentHashMap<String, Map<String, String>> hashes = new ConcurrentHashMap<>();
    public final ConcurrentHashMap<String, List<String>> lists = new ConcurrentHashMap<>();
    public final ConcurrentHashMap<String, Set<String>> sets = new ConcurrentHashMap<>();
    public final ConcurrentHashMap<String, Map<String, Double>> zsets = new ConcurrentHashMap<>();

    public Database(int index) {
        this.index = index;
    }

    public static class StringEntry {
        public String value;
        public long expiry;

        public StringEntry(String value, long ttlMs) {
            this.value = value;
            this.expiry = ttlMs > 0 ? System.currentTimeMillis() + ttlMs : 0;
        }

        public boolean isExpired() {
            return expiry > 0 && System.currentTimeMillis() >= expiry;
        }
    }

    // String ops
    public void setString(String key, String value, long ttlMs) {
        strings.put(key, new StringEntry(value, ttlMs));
    }

    public String getString(String key) {
        StringEntry entry = strings.get(key);
        if (entry == null) return null;
        if (entry.isExpired()) { strings.remove(key); return null; }
        return entry.value;
    }

    public int delString(String key) {
        return strings.remove(key) != null ? 1 : 0;
    }

    public boolean existsKey(String key) {
        StringEntry entry = strings.get(key);
        if (entry == null) return false;
        if (entry.isExpired()) { strings.remove(key); return false; }
        return true;
    }

    public int expireKey(String key, long ttlMs) {
        StringEntry entry = strings.get(key);
        if (entry == null) return 0;
        entry.expiry = System.currentTimeMillis() + ttlMs;
        return 1;
    }

    public int incrby(String key, long increment) {
        String val = getString(key);
        long num = (val == null ? 0 : Long.parseLong(val)) + increment;
        setString(key, String.valueOf(num), 0);
        return (int) num;
    }

    // Hash ops
    public void hset(String key, String field, String value) {
        hashes.computeIfAbsent(key, k -> new ConcurrentHashMap<>()).put(field, value);
    }

    public int hsetnx(String key, String field, String value) {
        Map<String, String> hash = hashes.computeIfAbsent(key, k -> new ConcurrentHashMap<>());
        if (hash.containsKey(field)) return 0;
        hash.put(field, value);
        return 1;
    }

    public String hget(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return null;
        return hash.get(field);
    }

    public Map<String, String> hgetall(String key) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return new LinkedHashMap<>();
        return new LinkedHashMap<>(hash);
    }

    public int hdel(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return 0;
        int result = hash.remove(field) != null ? 1 : 0;
        if (hash.isEmpty()) hashes.remove(key);
        return result;
    }

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

    public int hexists(String key, String field) {
        Map<String, String> hash = hashes.get(key);
        if (hash == null) return 0;
        return hash.containsKey(field) ? 1 : 0;
    }

    public int hlen(String key) {
        Map<String, String> hash = hashes.get(key);
        return hash == null ? 0 : hash.size();
    }

    // List ops
    public int lpush(String key, List<String> values) {
        List<String> list = lists.computeIfAbsent(key, k -> new ArrayList<>());
        for (int i = 0; i < values.size(); i++) {
            list.add(0, values.get(i));
        }
        return list.size();
    }

    public int rpush(String key, List<String> values) {
        List<String> list = lists.computeIfAbsent(key, k -> new ArrayList<>());
        list.addAll(values);
        return list.size();
    }

    public String lpop(String key) {
        List<String> list = lists.get(key);
        if (list == null || list.isEmpty()) return null;
        return list.remove(0);
    }

    public String rpop(String key) {
        List<String> list = lists.get(key);
        if (list == null || list.isEmpty()) return null;
        return list.remove(list.size() - 1);
    }

    public int llen(String key) {
        List<String> list = lists.get(key);
        return list == null ? 0 : list.size();
    }

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

    // Set ops
    public int sadd(String key, List<String> members) {
        Set<String> set = sets.computeIfAbsent(key, k -> ConcurrentHashMap.newKeySet());
        int added = 0;
        for (String m : members) {
            if (set.add(m)) added++;
        }
        return added;
    }

    public int srem(String key, List<String> members) {
        Set<String> set = sets.get(key);
        if (set == null) return 0;
        int removed = 0;
        for (String m : members) {
            if (set.remove(m)) removed++;
        }
        if (set.isEmpty()) sets.remove(key);
        return removed;
    }

    public int sismember(String key, String member) {
        Set<String> set = sets.get(key);
        return (set != null && set.contains(member)) ? 1 : 0;
    }

    public Set<String> smembers(String key) {
        Set<String> set = sets.get(key);
        if (set == null) return Collections.emptySet();
        return new LinkedHashSet<>(set);
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

    // Keys
    public List<String> keysByPattern(String pattern) {
        Pattern regex = patternToRegex(pattern);
        Set<String> allKeys = new LinkedHashSet<>();
        allKeys.addAll(strings.keySet());
        allKeys.addAll(hashes.keySet());
        allKeys.addAll(lists.keySet());
        allKeys.addAll(sets.keySet());
        allKeys.addAll(zsets.keySet());
        List<String> result = new ArrayList<>();
        for (String key : allKeys) {
            if (regex.matcher(key).matches()) result.add(key);
        }
        return result;
    }

    public int deleteKey(String key) {
        int deleted = 0;
        if (strings.remove(key) != null) deleted++;
        if (hashes.remove(key) != null) deleted++;
        if (lists.remove(key) != null) deleted++;
        if (sets.remove(key) != null) deleted++;
        if (zsets.remove(key) != null) deleted++;
        return deleted > 0 ? 1 : 0;
    }

    public int deleteKeys(List<String> keys) {
        int count = 0;
        for (String key : keys) count += deleteKey(key);
        return count;
    }

    public void flushDb() {
        strings.clear();
        hashes.clear();
        lists.clear();
        sets.clear();
        zsets.clear();
    }

    public int dbSize() {
        return strings.size() + hashes.size() + lists.size() + sets.size() + zsets.size();
    }

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

    public static class ZMember {
        public final double score;
        public final String member;

        public ZMember(double score, String member) {
            this.score = score;
            this.member = member;
        }
    }
}
