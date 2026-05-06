# lin-redis (Java)

Java implementation of a Redis-compatible server using Netty NIO with RESP2 protocol support.

## Tech Stack

- **Language**: Java 17
- **Network**: Netty 4.x (NIO, non-blocking)
- **Storage**: `ConcurrentHashMap` with `ScheduledExecutorService` for TTL sweep
- **Build**: Maven 3.x
- **Test Client**: Jedis 5.x + JUnit 5

## Quick Start

```bash
# Compile
mvn compile

# Run
LIN_REDIS_PORT=6379 mvn exec:java -Dexec.mainClass="cn.linnin.linredis.LinRedisApplication"

# Or use the script
LIN_REDIS_PORT=6379 bash start.sh
```

## Test

```bash
mvn test
```

Generates `test-reports/java-report.json` and `test-reports/java-report.txt`.

**Result**: 33/33 all pass.

## Structure

```
java/src/main/java/cn/linnin/linredis/
├── LinRedisApplication.java  # Entry point
├── protocol/
│   ├── RespDecoder.java       # RESP2 ByteToMessageDecoder (Netty)
│   └── RespEncoder.java       # RESP2 response encoder
├── command/
│   ├── CommandHandler.java    # @FunctionalInterface
│   ├── CommandRouter.java     # Command registry + dispatch
│   ├── StringCommands.java    # GET/SET/DEL/EXISTS/KEYS/MGET/INCRBY...
│   ├── HashCommands.java      # HSET/HMSET/HGET/HGETALL/HDEL/HMGET...
│   ├── ListCommands.java      # LPUSH/RPUSH/LPOP/RPOP/LLEN/LRANGE...
│   ├── SetCommands.java       # SADD/SREM/SISMEMBER/SMEMBERS...
│   ├── ZSetCommands.java      # ZADD/ZSCORE/ZRANGE/ZRANGEBYSCORE...
│   └── ServerCommands.java    # PING/SELECT/FLUSHDB/SCAN/INFO...
├── server/
│   ├── RedisServer.java       # Netty ServerBootstrap + NioEventLoopGroup
│   ├── RedisChannelHandler.java # ChannelInboundHandlerAdapter
│   └── ClientState.java       # Per-connection state (db, auth)
└── store/
    └── Database.java          # Multi-DB ConcurrentHashMap store
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `LIN_REDIS_PORT` | `6389` | Server port |
| `LIN_REDIS_HOST` | `127.0.0.1` | Bind address |
| `LIN_REDIS_PASSWORD` | `""` | AUTH password |

## Performance

- Non-blocking NIO with Netty event loops
- Thread-safe `ConcurrentHashMap` for concurrent client access
- Periodic expiry sweep every 100ms on single-thread scheduler
- No persistence (纯内存缓存)
