package cn.linnin.linredis;

import cn.linnin.linredis.server.RedisServer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import redis.clients.jedis.Jedis;
import java.io.File;
import java.io.FileWriter;
import java.nio.file.*;
import java.util.*;

@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
public class LinRedisTestRunner {

    private static RedisServer server;
    private static Jedis jedis;
    private static final int PORT = 16390;
    private static final String HOST = "127.0.0.1";
    private static List<SuiteResult> suiteResults = new ArrayList<>();
    private static SuiteResult currentSuite;
    private static final ObjectMapper mapper = new ObjectMapper();

    @BeforeAll
    static void startServer() throws Exception {
        server = new RedisServer(PORT, HOST, "");
        server.start();
        Thread.sleep(200);
        jedis = new Jedis(HOST, PORT);
        jedis.connect();
    }

    @AfterAll
    static void stopServer() throws Exception {
        if (jedis != null) jedis.close();
        if (server != null) server.stop();
        generateReport();
    }

    private static void beginSuite(String name) {
        currentSuite = new SuiteResult(name);
    }

    private static void endSuite() {
        if (currentSuite != null) suiteResults.add(currentSuite);
    }

    private static void assertTest(boolean condition, String message) {
        TestCaseResult tcr = new TestCaseResult();
        long start = System.currentTimeMillis();
        try {
            if (!condition) throw new AssertionError(message);
            tcr.status = "PASS";
        } catch (Throwable e) {
            tcr.status = "FAIL";
            tcr.message = e.getMessage();
        }
        tcr.durationMs = System.currentTimeMillis() - start;
        if (currentSuite != null) currentSuite.cases.add(tcr);
    }

    static void generateReport() throws Exception {
        String reportDir = System.getProperty("user.dir") + "/../../test-reports";
        Files.createDirectories(Paths.get(reportDir));

        int total = 0, passed = 0, failed = 0;
        for (SuiteResult s : suiteResults) {
            for (TestCaseResult c : s.cases) {
                total++;
                if ("PASS".equals(c.status)) passed++; else failed++;
            }
        }

        Map<String, Object> report = new LinkedHashMap<>();
        report.put("timestamp", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").format(new Date()));
        report.put("version", "java");
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("total", total);
        summary.put("passed", passed);
        summary.put("failed", failed);
        summary.put("skipped", 0);
        report.put("summary", summary);
        report.put("suites", suiteResults);

        mapper.writerWithDefaultPrettyPrinter().writeValue(new File(reportDir + "/java-report.json"), report);

        StringBuilder txt = new StringBuilder();
        txt.append("lin-redis (Java) Test Report\n");
        txt.append("============================\n");
        txt.append("Timestamp: ").append(report.get("timestamp")).append("\n\n");
        for (SuiteResult s : suiteResults) {
            int sf = 0;
            for (TestCaseResult c : s.cases) if ("FAIL".equals(c.status)) sf++;
            txt.append("[").append(sf == 0 ? "PASS" : "FAIL").append("] Suite: ").append(s.name).append("\n");
            for (TestCaseResult c : s.cases) {
                txt.append("  [").append("PASS".equals(c.status) ? "OK" : "XX").append("] ").append(c.command);
                txt.append(" (").append(c.durationMs).append("ms)");
                if (c.message != null) txt.append(" - ").append(c.message);
                txt.append("\n");
            }
            txt.append("\n");
        }
        txt.append("Total: ").append(passed).append("/").append(total).append(" passed, ").append(failed).append(" failed\n");
        Files.write(Paths.get(reportDir + "/java-report.txt"), txt.toString().getBytes());

        System.out.println("\n=== lin-redis (Java) Test Report ===");
        System.out.println(txt);
    }

    public static class SuiteResult {
        public String name;
        public List<TestCaseResult> cases = new ArrayList<>();
        public SuiteResult() {}
        public SuiteResult(String name) { this.name = name; }
        public int getPassed() { return (int) cases.stream().filter(c -> "PASS".equals(c.status)).count(); }
        public int getFailed() { return (int) cases.stream().filter(c -> "FAIL".equals(c.status)).count(); }
    }

    public static class TestCaseResult {
        public String command;
        public String status;
        public long durationMs;
        public String message;
    }

    private static void record(String command, Runnable test) {
        TestCaseResult tcr = new TestCaseResult();
        tcr.command = command;
        long start = System.currentTimeMillis();
        try {
            test.run();
            tcr.status = "PASS";
        } catch (Throwable e) {
            tcr.status = "FAIL";
            tcr.message = e.getMessage();
        }
        tcr.durationMs = System.currentTimeMillis() - start;
        if (currentSuite != null) currentSuite.cases.add(tcr);
    }

    // ===== String Commands =====
    @Test @Order(1)
    void testStringCommands() {
        beginSuite("String Commands");
        record("SET basic", () -> jedis.set("test:str:1", "hello"));
        record("GET existing", () -> {
            jedis.set("test:str:2", "world");
            if (!"world".equals(jedis.get("test:str:2"))) throw new RuntimeException("Expected world");
        });
        record("GET non-existing", () -> {
            if (jedis.get("test:str:nonexist") != null) throw new RuntimeException("Expected null");
        });
        record("SETEX", () -> {
            jedis.setex("test:str:setex", 2, "val");
            if (!"val".equals(jedis.get("test:str:setex"))) throw new RuntimeException("Expected val");
            try { Thread.sleep(2500); } catch (Exception ignored) {}
            if (jedis.get("test:str:setex") != null) throw new RuntimeException("Expected null after expiry");
        });
        record("DEL", () -> {
            jedis.set("test:str:del1", "x");
            jedis.set("test:str:del2", "y");
            if (jedis.del("test:str:del1", "test:str:del2") != 2) throw new RuntimeException("Expected 2");
        });
        record("EXISTS", () -> {
            jedis.set("test:str:exists1", "yes");
            if (!jedis.exists("test:str:exists1")) throw new RuntimeException("Expected true");
            if (jedis.exists("test:str:exists_nope")) throw new RuntimeException("Expected false");
        });
        record("EXPIRE", () -> {
            jedis.set("test:str:exp", "ttl");
            if (jedis.expire("test:str:exp", 1) != 1) throw new RuntimeException("Expected 1");
            try { Thread.sleep(1500); } catch (Exception ignored) {}
            if (jedis.get("test:str:exp") != null) throw new RuntimeException("Expected null");
        });
        record("INCR / INCRBY", () -> {
            jedis.set("test:str:counter", "10");
            if (jedis.incr("test:str:counter") != 11) throw new RuntimeException("Expected 11");
            if (jedis.incrBy("test:str:counter", 5) != 16) throw new RuntimeException("Expected 16");
        });
        record("MGET", () -> {
            jedis.set("test:str:mg1", "a");
            jedis.set("test:str:mg2", "b");
            List<String> vals = jedis.mget("test:str:mg1", "test:str:mg2", "test:str:nope");
            if (!"a".equals(vals.get(0))) throw new RuntimeException("Expected a");
            if (!"b".equals(vals.get(1))) throw new RuntimeException("Expected b");
            if (vals.get(2) != null) throw new RuntimeException("Expected null");
        });
        record("KEYS pattern", () -> {
            jedis.set("test:keys:alpha", "1");
            jedis.set("test:keys:beta", "2");
            Set<String> keys = jedis.keys("test:keys:*");
            if (keys.size() != 2) throw new RuntimeException("Expected 2 keys, got " + keys.size());
        });
        record("okbang user:token pattern", () -> {
            jedis.set("user:token:abc123", "{\"userId\":1}");
            jedis.set("user:token:def456", "{\"userId\":2}");
            if (jedis.keys("user:token:*").size() != 2) throw new RuntimeException("Expected 2 tokens");
        });
        record("SET NX / XX", () -> {
            jedis.del("test:nx");
            if (!"OK".equals(jedis.set("test:nx", "first", new redis.clients.jedis.params.SetParams().nx())))
                throw new RuntimeException("NX should succeed");
            if (jedis.set("test:nx", "second", new redis.clients.jedis.params.SetParams().nx()) != null)
                throw new RuntimeException("NX should return null");
        });
        endSuite();
    }

    // ===== Hash Commands =====
    @Test @Order(2)
    void testHashCommands() {
        beginSuite("Hash Commands");
        record("HSET / HGET", () -> {
            jedis.hset("test:hash:1", "name", "Alice");
            if (!"Alice".equals(jedis.hget("test:hash:1", "name"))) throw new RuntimeException("Expected Alice");
        });
        record("HMSET / HGETALL", () -> {
            Map<String, String> map = new HashMap<>();
            map.put("a", "1");
            map.put("b", "2");
            jedis.hmset("test:hash:2", map);
            Map<String, String> all = jedis.hgetAll("test:hash:2");
            if (!"1".equals(all.get("a"))) throw new RuntimeException("Expected 1");
            if (all.size() != 2) throw new RuntimeException("Expected 2 fields");
        });
        record("HDEL", () -> {
            jedis.hset("test:hash:3", "x", "10");
            if (jedis.hdel("test:hash:3", "x") != 1) throw new RuntimeException("Expected 1");
        });
        record("HMGET", () -> {
            jedis.hset("test:hash:4", "f1", "v1");
            jedis.hset("test:hash:4", "f2", "v2");
            List<String> vals = jedis.hmget("test:hash:4", "f1", "f3");
            if (!"v1".equals(vals.get(0))) throw new RuntimeException("Expected v1");
            if (vals.get(1) != null) throw new RuntimeException("Expected null");
        });
        record("okbang HTTP log hash", () -> {
            String key = "log:v1:user:login:123:99";
            jedis.hset(key, "method", "POST");
            jedis.hset(key, "status", "200");
            Map<String, String> all = jedis.hgetAll(key);
            if (!"POST".equals(all.get("method"))) throw new RuntimeException("Expected POST");
        });
        endSuite();
    }

    // ===== List Commands =====
    @Test @Order(3)
    void testListCommands() {
        beginSuite("List Commands");
        record("RPUSH / LRANGE", () -> {
            jedis.del("test:list:1");
            if (jedis.rpush("test:list:1", "a", "b", "c") != 3) throw new RuntimeException("Expected 3");
            List<String> range = jedis.lrange("test:list:1", 0, -1);
            if (!"a".equals(range.get(0))) throw new RuntimeException("Expected a");
        });
        record("LPUSH", () -> {
            jedis.del("test:list:2");
            jedis.lpush("test:list:2", "c", "b", "a");
            List<String> range = jedis.lrange("test:list:2", 0, -1);
            if (!"a".equals(range.get(0))) throw new RuntimeException("Expected a first, got " + range.get(0));
        });
        record("LLEN", () -> {
            jedis.del("test:list:3");
            jedis.rpush("test:list:3", "x", "y");
            if (jedis.llen("test:list:3") != 2) throw new RuntimeException("Expected 2");
        });
        record("LPOP / RPOP", () -> {
            jedis.del("test:list:4");
            jedis.rpush("test:list:4", "1", "2", "3");
            if (!"1".equals(jedis.lpop("test:list:4"))) throw new RuntimeException("Expected 1 from LPOP");
            if (!"3".equals(jedis.rpop("test:list:4"))) throw new RuntimeException("Expected 3 from RPOP");
        });
        endSuite();
    }

    // ===== Set Commands =====
    @Test @Order(4)
    void testSetCommands() {
        beginSuite("Set Commands");
        record("SADD / SMEMBERS", () -> {
            jedis.del("test:set:1");
            if (jedis.sadd("test:set:1", "a", "b", "c") != 3) throw new RuntimeException("Expected 3");
            if (jedis.smembers("test:set:1").size() != 3) throw new RuntimeException("Expected 3 members");
        });
        record("SISMEMBER", () -> {
            jedis.del("test:set:2");
            jedis.sadd("test:set:2", "member1");
            if (!jedis.sismember("test:set:2", "member1")) throw new RuntimeException("Expected true");
            if (jedis.sismember("test:set:2", "nope")) throw new RuntimeException("Expected false");
        });
        record("SREM", () -> {
            jedis.del("test:set:3");
            jedis.sadd("test:set:3", "x", "y", "z");
            if (jedis.srem("test:set:3", "x", "z") != 2) throw new RuntimeException("Expected 2");
        });
        endSuite();
    }

    // ===== ZSet Commands =====
    @Test @Order(5)
    void testZSetCommands() {
        beginSuite("ZSet Commands");
        record("ZADD / ZSCORE", () -> {
            jedis.del("test:zset:1");
            jedis.zadd("test:zset:1", 1.0, "one");
            jedis.zadd("test:zset:1", 2.0, "two");
            if (jedis.zscore("test:zset:1", "two") != 2.0) throw new RuntimeException("Expected 2.0");
        });
        record("ZRANGE", () -> {
            jedis.del("test:zset:2");
            jedis.zadd("test:zset:2", 10.0, "a");
            jedis.zadd("test:zset:2", 20.0, "b");
            List<String> range = jedis.zrange("test:zset:2", 0, -1);
            if (!"a".equals(range.get(0))) throw new RuntimeException("Expected a");
        });
        record("ZRANGEBYSCORE", () -> {
            jedis.del("test:zset:3");
            jedis.zadd("test:zset:3", 10.0, "a");
            jedis.zadd("test:zset:3", 20.0, "b");
            jedis.zadd("test:zset:3", 30.0, "c");
            List<String> range = jedis.zrangeByScore("test:zset:3", 15, 25);
            if (range.size() != 1) throw new RuntimeException("Expected 1, got " + range.size());
        });
        record("okbang sentence ZSet", () -> {
            String key = "okbang:bundle:category:greetings";
            jedis.del(key);
            jedis.zadd(key, 5.0, "Hello");
            jedis.zadd(key, 12.0, "How are you?");
            if (jedis.zrangeByScore(key, 5, 10).size() != 1) throw new RuntimeException("Expected 1 sentence");
        });
        record("ZREM / ZCARD", () -> {
            jedis.del("test:zset:4");
            jedis.zadd("test:zset:4", 1.0, "a");
            jedis.zadd("test:zset:4", 2.0, "b");
            jedis.zadd("test:zset:4", 3.0, "c");
            if (jedis.zrem("test:zset:4", "a") != 1) throw new RuntimeException("Expected 1 removed");
            if (jedis.zcard("test:zset:4") != 2) throw new RuntimeException("Expected 2");
        });
        endSuite();
    }

    // ===== Server Commands =====
    @Test @Order(6)
    void testServerCommands() {
        beginSuite("Server Commands");
        record("PING", () -> {
            if (!"PONG".equals(jedis.ping())) throw new RuntimeException("Expected PONG");
        });
        record("SELECT / FLUSHDB", () -> {
            jedis.select(5);
            jedis.set("test:db5:key", "value");
            if (!"value".equals(jedis.get("test:db5:key"))) throw new RuntimeException("Expected value in DB5");
            jedis.flushDB();
            if (jedis.get("test:db5:key") != null) throw new RuntimeException("Expected null after FLUSHDB");
            jedis.select(0);
        });
        record("SCAN", () -> {
            jedis.set("test:scan:1", "a");
            jedis.set("test:scan:2", "b");
            var result = jedis.scan("0", new redis.clients.jedis.params.ScanParams().match("test:scan:*"));
            if (result.getResult().size() < 2) throw new RuntimeException("Expected at least 2 keys");
        });
        record("okbang DB 0/9/10/11/12", () -> {
            for (int db : new int[]{0, 9, 10, 11, 12}) {
                jedis.select(db);
                jedis.set("okbang:db" + db, "val");
                if (!"val".equals(jedis.get("okbang:db" + db))) throw new RuntimeException("DB " + db + " failed");
            }
            jedis.select(0);
        });
        endSuite();
    }
}
