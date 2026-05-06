# lin-redis

A minimal **Redis-compatible server** (仿 Redis 服务) implementing the RESP2 protocol, built in both **Node.js** and **Java**.

Designed as a drop-in replacement for Redis in the [okbang](https://github.com/linnin233/okbang) project, supporting all 34+ Redis commands used by okbang's API and microservice layers.

## Features

- **RESP2 protocol** — compatible with any standard Redis client (`ioredis`, `node-redis`, `Jedis`, `Lettuce`, `redis-cli`)
- **34+ Redis commands** — String, Hash, List, Set, ZSet, Server
- **Multi-database** — SELECT 0–15, isolated per connection
- **TTL / expiry** — lazy deletion + periodic sweep (100ms)
- **AUTH password** — optional password protection
- **AB hot-swap ready** — designed for okbang-api's sentence cache rebuild pattern

## Project Structure

```
lin-redis/
├── js/              # Node.js implementation (67 commands, 57 tests)
├── java/            # Java implementation (51 commands, 33 tests)
├── tools/           # redis-commander web GUI
├── test-reports/    # Automated test reports (JSON + TXT)
├── start.sh         # Quick-start script
└── README.md
```

## Quick Start

### JS Version
```bash
cd js
npm install
LIN_REDIS_PORT=6379 node src/index.js    # starts on port 6379
```

### Java Version
```bash
cd java
LIN_REDIS_PORT=6379 mvn exec:java -Dexec.mainClass="cn.linnin.linredis.LinRedisApplication"
```

### Connect with any Redis client
```bash
redis-cli -p 6379 PING   # → PONG
```

## Test Results

| Version | Tests | Passed | Failed |
|---------|-------|--------|--------|
| JS      | 57    | 57     | 0      |
| Java    | 33    | 33     | 0      |
| **Total** | **90** | **90** | **0** |

## Commands Supported

**String**: `GET SET SETEX SETNX DEL EXISTS EXPIRE KEYS MGET MSET INCR INCRBY DECR DECRBY APPEND STRLEN TTL TYPE`

**Hash**: `HSET HMSET HGET HGETALL HDEL HMGET HEXISTS HLEN HKEYS HVALS HSETNX`

**List**: `LPUSH RPUSH LPOP RPOP LLEN LRANGE LINDEX LSET LREM`

**Set**: `SADD SREM SISMEMBER SMEMBERS SCARD SPOP SRANDMEMBER`

**ZSet**: `ZADD ZSCORE ZRANGE ZRANGEBYSCORE ZCARD ZREM ZCOUNT`

**Server**: `PING SELECT AUTH FLUSHDB FLUSHALL SCAN DBSIZE RANDOMKEY QUIT INFO COMMAND CONFIG`

## License

MIT
