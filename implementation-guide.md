# lin-redis 实现详解

## 一、整体架构

lin-redis 是一个兼容 Redis RESP2 协议的键值存储服务器，用 Node.js 和 Java 两种语言分别实现，核心架构完全一致。

```
                        redis-cli / ioredis / Jedis 等标准客户端
                                    │
                           RESP2 协议 (TCP)
                                    │
                    ┌───────────────┴───────────────┐
                    │         TCP Server            │
                    │   (JS: net 模块 / Java: Netty) │
                    ├───────────────────────────────┤
                    │      ClientState (每连接)      │
                    │    - dbIndex: 当前数据库        │
                    │    - authenticated: 认证状态    │
                    │    - parser: RESP解析器         │
                    ├───────────────┬───────────────┤
                    │   RespParser  │ CommandRouter  │
                    │   (流式解析)   │  (命令分发)     │
                    ├───────────────┴───────────────┤
                    │          Database × 16         │
                    │   strings | hashes | lists     │
                    │   sets    | zsets              │
                    └───────────────┬───────────────┘
                                    │
                              ExpiryManager
                            (每 100ms 扫描)
```

---

## 二、RESP 协议 — 客户端和服务器的通信语言

Redis 客户端和服务器的通信使用 RESP (REdis Serialization Protocol)。协议定义了 5 种**数据类型**，所有数据都以 `\r\n` 结尾。

### 2.1 五种 RESP 类型

```
类型          前缀    示例                             含义
─────────────────────────────────────────────────────────────────
简单字符串     +      +OK\r\n                        状态回复
错误          -      -ERR unknown command\r\n       错误消息
整数          :      :100\r\n                       数值
批量字符串     $      $6\r\nfoobar\r\n               变长字符串（$后跟字节数）
              $      $-1\r\n                        表示 null
数组          *      *2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n  包含2个批量字符串
              *      *-1\r\n                        表示 null 数组
```

### 2.2 请求和响应示例

**SET 命令** — 客户端发送：
```
*3\r\n           ← 3个元素的数组
$3\r\nSET\r\n    ← 第1个元素: 命令名 "SET" (3字节)
$4\r\nname\r\n   ← 第2个元素: key = "name" (4字节)
$5\r\nAlice\r\n  ← 第3个元素: value = "Alice" (5字节)
```
服务器回复：
```
+OK\r\n          ← 简单字符串 OK
```

**GET 命令** — 客户端发送：
```
*2\r\n
$3\r\nGET\r\n
$4\r\nname\r\n
```
服务器回复：
```
$5\r\nAlice\r\n  ← 批量字符串 "Alice"
```

---

## 三、协议解析器 — 流式解析 (核心难点)

TCP 是**字节流**，客户端一次发送的数据可能被拆成多个 TCP 包到达（拆包），也可能多个请求合并到一个包（粘包）。因此解析器必须是**流式**的。

### 3.1 设计思路

```
 [  |  |  |  |  |  |  |  |  |  |  |  ]   ← Buffer (字节缓冲区)
         ↑
   每次 feed(data) 追加数据，然后尝试 tryParse()
   如果数据不完整 → 返回 null，保留 buffer，等待下一次 feed
   如果数据完整   → 消耗已解析的字节，移出 buffer
```

### 3.2 核心代码解读 (JS)

```javascript
// 入口: 接收新数据
feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);  // 追加到缓冲区
    const results = [];
    while (true) {
        const result = this.tryParse();
        if (result === null) break;    // 数据不完整, 等下次
        results.push(result);          // 解析成功, 继续尝试
    }
    return results;
}

// 尝试解析一个完整值
tryParse() {
    const saved = this.buffer;    // ← 保存点: 解析失败要恢复
    try {
        const [parsed, consumed] = this._parseValue(0);
        if (parsed === undefined) {
            this.buffer = saved;  // 恢复, 等待更多数据
            return null;
        }
        this.buffer = this.buffer.slice(consumed);  // 消耗已解析数据
        return parsed;
    } catch (e) {
        this.buffer = saved;      // 异常也恢复
        return null;
    }
}
```

### 3.3 解析流程: 数组递归解析

```
*3\r\n$3\r\nSET\r\n$4\r\nname\r\n$5\r\nAlice\r\n
│
├─ 读到 '*' → 进入 _parseArray
│   ├─ 读到 count = 3
│   └─ 循环3次, 每次调用 _parseValue:
│       ├─ 读到 '$' → _parseBulkString → "SET"
│       ├─ 读到 '$' → _parseBulkString → "name"
│       └─ 读到 '$' → _parseBulkString → "Alice"
│
└─ 返回 ["SET", "name", "Alice"]
```

如果数组中任何一个元素的数据不完整，整个数组解析**回滚**到初始位置，等下次数据到达再尝试。

### 3.4 Java 版本的区别

Java 版使用 Netty 的 `ByteToMessageDecoder`，Netty 自动管理缓冲区，原理相同但不需要手动维护保存点:

```java
protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
    int readerIndex = in.readerIndex();    // 记录位置
    Object result = parseValue(in);
    if (result == null) {
        in.readerIndex(readerIndex);        // 恢复位置 (Netty自动做了)
        return;                              // 等更多数据
    }
    out.add(result);
}
```

---

## 四、服务器层 — 连接管理

### 4.1 启动流程

```
main()
  └─ new LinRedisServer({port, host, password})
       ├─ 创建 Database(0) 作为默认数据库
       ├─ 初始化 CommandRouter
       ├─ 注册所有命令(6个模块, 34+命令)
       └─ server.start()
            ├─ 创建 TCP Server (net.createServer / Netty Bootstrap)
            ├─ 每个连接 → new ClientState(server, socket)
            │    ├─ dbIndex = 0
            │    ├─ authenticated = !server.requirePass
            │    └─ parser = new RespParser()
            ├─ 监听 socket.data → client.handleData(data)
            └─ 启动 ExpiryManager (每100ms扫描)
```

### 4.2 ClientState — 每个连接一个实例

每个客户端连接持有一个 `ClientState`，它维护了:

| 属性 | 含义 | 默认值 |
|------|------|--------|
| `dbIndex` | 当前选中的数据库 (SELECT 命令切换) | 0 |
| `authenticated` | 是否已认证 | 无密码时为 true |
| `parser` | RESP 流式解析器实例 | RespParser |
| `buffer` | 认证前的纯文本缓冲区 | '' |

### 4.3 认证流程

```
客户端连接 ──────────────────────────────────────────→
  │
  ├─ 已认证? (无密码配置)
  │    是 → 直接进入 RESP 解析模式
  │
  └─ 未认证? (有密码配置)
        ├─ 收到的数据先进入 buffer (纯文本模式)
        ├─ 只识别 AUTH 命令
        ├─ 其他命令返回 -ERR NOAUTH
        ├─ AUTH <password> 正确:
        │   authenticated = true, 清空 parser 和 buffer
        └─ AUTH <password> 错误:
            返回 -ERR invalid password
```

### 4.4 命令处理流程

```
socket.data 事件
  └─ client.handleData(data)
       ├─ 未认证 → 走认证流程
       └─ 已认证 → parser.feed(data) → 解析出命令数组 [["SET","key","val"], ...]
                     └─ 每个命令 → client.handleCommand(cmd)
                          ├─ 提取命令名 (大写)
                          ├─ QUIT? → 发送 OK, 关闭连接
                          └─ router.dispatch(client, cmdName, args) → 返回 RESP 字符串
                               client.send(response)
```

---

## 五、命令路由系统

### 5.1 CommandRouter — 简单的 Map 分发

```javascript
class CommandRouter {
    constructor() {
        this.commands = new Map();    // Map<命令名, 处理函数>
    }
    register(name, handler) {
        this.commands.set(name.toUpperCase(), handler);
    }
    dispatch(client, commandName, args) {
        const handler = this.commands.get(commandName);
        if (!handler) return serializeError(`unknown command '${commandName}'`);
        try {
            return handler(client, args);     // 调用处理函数
        } catch (err) {
            return serializeError(`ERR ${err.message}`);
        }
    }
}
```

### 5.2 命令注册 (6 个模块)

```
registerStringCommands(router)  → SET, GET, MSET, MGET, INCR, DECR, DEL, EXISTS, EXPIRE...
registerHashCommands(router)    → HSET, HGET, HGETALL, HDEL, HMGET, HEXISTS, HLEN...
registerListCommands(router)    → LPUSH, RPUSH, LPOP, RPOP, LLEN, LRANGE...
registerSetCommands(router)     → SADD, SREM, SISMEMBER, SMEMBERS, SCARD...
registerZSetCommands(router)    → ZADD, ZSCORE, ZRANGE, ZRANGEBYSCORE, ZCARD, ZREM...
registerServerCommands(router)  → PING, SELECT, AUTH, FLUSHDB, INFO, SCAN, DBSIZE...
```

### 5.3 一个命令的实现示例 (HSET)

```javascript
router.register('HSET', (client, args) => {
    // 1. 参数校验
    if (args.length < 3 || args.length % 2 !== 1)
        return serializeError('wrong number of arguments for HSET');

    const key = args[0];          // 哈希表名
    const db = client.getDb();    // 获取当前选中的数据库
    let count = 0;

    // 2. 批量设置 field-value 对
    for (let i = 1; i < args.length; i += 2) {
        const existed = db.getHashField(key, args[i]) !== null;
        db.setHashField(key, args[i], args[i + 1]);
        if (!existed) count++;    // 只统计新增字段
    }
    // 3. 返回 RESP 格式结果
    return serializeInteger(count);
});
```

---

## 六、存储引擎 — 五种数据类型

### 6.1 存储结构

每个 Database 实例包含 5 个独立的 Map:

```javascript
class Database {
    constructor(index) {
        this.index = index;               // 数据库编号 (0-15)

        this.strings = new Map();          // Map<key, {value, _expiry}>
        this.hashes  = new Map();          // Map<key, {value: Map<field, val>, _expiry}>
        this.lists   = new Map();          // Map<key, {value: Array, _expiry}>
        this.sets    = new Map();          // Map<key, {value: Set, _expiry}>
        this.zsets   = new Map();          // Map<key, {value: Map<member, score>, _expiry}>
    }
}
```

每个值都包装在 `entry` 对象中:
```javascript
{ value: <实际数据>, _expiry: <过期时间戳 | undefined> }
```

### 6.2 String — 最基础的类型

实现很简单，就是一个 `Map<key, entry>`:
```javascript
setString(key, value, ttlMs) {
    this.strings.set(key, this._wrapValue(value, ttlMs));
}
getString(key) {
    const entry = this.strings.get(key);
    const val = this._unwrapEntry(entry);   // 检查过期
    if (val === undefined && entry) this.strings.delete(key);  // 惰性删除
    return val;
}
```

### 6.3 Hash — field-value 映射

内部是一个嵌套 Map:
```
hashes: Map<key, entry<Map<field, value>>>
         ↑                    ↑
      哈希表名            字段名→值映射
```

```javascript
setHashField(key, field, value) {
    let hash = this.hashes.get(key);
    if (!hash) {
        hash = { value: new Map() };       // 自动创建
        this.hashes.set(key, hash);
    }
    hash.value.set(field, value);
}
```

HGETALL 返回**副本**防止外部修改:
```javascript
getHashAll(key) {
    return new Map(entry.value);    // 浅拷贝
}
```

### 6.4 List — 双向列表

使用 JS 的 `Array`，`unshift`/`push`/`shift`/`pop` 天然支持双向操作:

```
LPUSH a b c  →  [c, b, a]          (头部插入, 顺序反转)
RPUSH x y z  →  [..., x, y, z]     (尾部插入, 保持顺序)
LPOP         →  弹出左边第一个
RPOP         →  弹出右边最后一个
```

LRANGE 支持负数索引 (Redis 标准行为):
```javascript
listRange(key, start, stop) {
    let s = start < 0 ? Math.max(0, len + start) : start;   // -1 → len-1
    let e = stop < 0 ? len + stop : stop;
    return entry.value.slice(s, e + 1);
}
```

### 6.5 Set — 无序唯一集合

使用 JS 的 `Set`，自动保证唯一性:
```javascript
setAdd(key, members) {
    let entry = this.sets.get(key);
    if (!entry) { entry = { value: new Set() }; this.sets.set(key, entry); }
    let added = 0;
    for (const m of members) {
        if (!entry.value.has(m)) { entry.value.add(m); added++; }
    }
    return added;
}
```

### 6.6 ZSet (Sorted Set) — 有序集合

内部用 `Map<member, score>` 存储，**在查询时动态排序**:

```javascript
zsetRange(key, start, stop, withScores) {
    const entry = this.zsets.get(key);

    // 每次查询都排序 (简单但低效, 生产应使用跳表)
    const sorted = [...entry.value.entries()].sort((a, b) => {
        if (a[1] !== b[1]) return a[1] - b[1];       // 按分数
        return a[0].localeCompare(b[0]);               // 分数相同按字典序
    });

    // 取 [start, stop] 范围
    return sorted.slice(s, e + 1);
}
```

> **注**: 每次 `ZRANGE` 都要 `O(n log n)` 排序。真正的 Redis 使用**跳表 (skiplist)** 实现 ZSet，维护插入顺序，查询只需 `O(log n + m)`。

---

## 七、过期机制 — 惰性删除 + 定期清理

### 7.1 两种策略配合

```
┌──────────────────────────────────────────────────┐
│ 策略1: 惰性删除 (Lazy Deletion)                    │
│   GET key → _unwrapEntry(entry)                   │
│          → 检查 _expiry                           │
│          → 如果过期: 删除 entry, 返回 undefined     │
│                                                   │
│ 策略2: 定期清理 (Periodic Sweep)                   │
│   每 100ms, ExpiryManager 扫描所有数据库:          │
│     for db in databases:                          │
│       for [key, entry] in db.strings:             │
│         if entry._expiry <= Date.now():           │
│           db.strings.delete(key)                  │
└──────────────────────────────────────────────────┘
```

### 7.2 为什么需要两种策略

- **纯惰性删除**: 过期键不访问就不会被删除，可能导致内存泄漏
- **纯定期清理**: 实时性好但 CPU 开销大
- **混合策略**: 惰性删除保证访问时一定是有效的；定期清理兜底，防止过期键堆积

### 7.3 _wrapValue / _unwrapEntry

```javascript
// 写: 将 TTL 转为绝对时间戳
_wrapValue(value, ttlMs) {
    return { value, _expiry: ttlMs > 0 ? Date.now() + ttlMs : undefined };
}

// 读: 检查是否过期
_unwrapEntry(entry) {
    if (!entry) return undefined;
    if (entry._expiry && Date.now() >= entry._expiry) {
        return undefined;    // 过期
    }
    return entry.value;
}
```

---

## 八、JS 与 Java 实现对比

| 维度 | JS 版本 | Java 版本 |
|------|---------|-----------|
| **并发模型** | 单线程事件循环 (Node.js) | 多线程 Reactor (Netty Boss + Worker) |
| **TCP 框架** | `net` 模块 (Node 内置) | Netty (NIO, 非阻塞) |
| **线程安全** | 不需要 (单线程) | ConcurrentHashMap, 原子操作 |
| **RESP 解析** | 手动实现保存点回滚 | ByteToMessageDecoder 自动管理 |
| **存储结构** | Map (ES6) | ConcurrentHashMap |
| **过期清理** | setInterval (JS 定时器) | ScheduledExecutorService |
| **连接数** | 单线程处理所有连接 | Boss 1 线程 + Worker 多线程 |
| **命令数量** | 67 个 | 51 个 |

### 8.1 关键差异: 线程模型

```
JS 版本:                         Java 版本:
┌──────────┐                    ┌──────────────────────┐
│  Event   │                    │   Boss Group (1线程)  │
│  Loop    │ ← 所有连接         │   └─ accept新连接     │
│  单线程   │    所有命令         │                      │
│          │    解析+路由        │   Worker Group (N线程)│
│          │                    │   └─ handle IO事件    │
│          │    优势: 无竞争     │   └─ 解析+路由+存储   │
│          │    劣势: 单核      │                      │
└──────────┘                    │   需要 ConcurrentMap  │
                                 │   保证线程安全        │
                                 └──────────────────────┘
```

---

## 九、为什么能作为 okbang 的 Redis 替代品

okbang-api 使用的 Redis 命令都在 lin-redis 的支持范围内:

```
okbang-api 依赖的 Redis 操作        lin-redis 状态
─────────────────────────────────────────────────
GET/SET/HGET/HSET/HGETALL/HMSET     ✓ 全部支持
ZADD/ZRANGE/ZRANGEBYSCORE/ZREM      ✓ 全部支持
EXPIRE/TTL/DEL/EXISTS               ✓ 全部支持
AUTH/SELECT/PING/INFO               ✓ 全部支持
AB 库热切换 (db10/db11/db12)        ✓ 多数据库支持
```

**对接方式** — 只需把 okbang-api 的环境变量改为:
```bash
REDIS_HOST=127.0.0.1
REDIS_PORT=6389    # lin-redis 默认端口
REDIS_PASSWORD=    # 留空则无认证
```

客户端 `ioredis` 不需要任何修改，因为它使用的是标准 RESP2 协议。

---

## 十、从零收到一条 SET 命令的完整数据流

```
1. redis-cli 输入: SET name Alice
       │
2. redis-cli 编码为 RESP:
   *3\r\n$3\r\nSET\r\n$4\r\nname\r\n$5\r\nAlice\r\n
       │ TCP 发送
       ▼
3. Node.js net.Socket 'data' 事件触发
       │
4. client.handleData(data)
   ├─ authenticated? ✓
   └─ parser.feed(data)
       └─ 追加到 buffer
        └─ tryParse()
            └─ _parseValue(0) → 读到 '*'
                └─ _parseArray → count=3, 循环3次
                    ├─ _parseBulkString → "SET"
                    ├─ _parseBulkString → "name"
                    └─ _parseBulkString → "Alice"
            └─ 返回 ["SET", "name", "Alice"]
            └─ 从 buffer 中移除已解析字节
       │
5. client.handleCommand(["SET", "name", "Alice"])
   ├─ commandName = "SET"
   ├─ args = ["name", "Alice"]
   └─ router.dispatch(client, "SET", ["name", "Alice"])
       └─ commands.get("SET")(client, ["name", "Alice"])
           ├─ key = "name", value = "Alice", ttlMs = 0
           └─ db.setString("name", "Alice", 0)
               └─ strings.set("name", {value: "Alice"})
           └─ return "+OK\r\n"
       │
6. client.send("+OK\r\n")
   └─ socket.write("+OK\r\n")
       │ TCP 发送
       ▼
7. redis-cli 收到 "+OK\r\n"
   └─ 解析 RESP
   └─ 显示 "OK"
```

整个过程从客户端发送到收到回复，每一步都是同步、确定性的。
