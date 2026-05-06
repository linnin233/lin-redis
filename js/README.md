# lin-redis (JS)

Node.js implementation of a Redis-compatible server using the native `net` module with RESP2 protocol parsing.

## Tech Stack

- **Runtime**: Node.js 18+
- **Network**: `net` module (zero extra deps for the server)
- **Storage**: In-memory `Map` with lazy + periodic expiry
- **Test Client**: `ioredis` ^5.x

## Quick Start

```bash
npm install
npm start                    # default port 6389

# Or specify port
LIN_REDIS_PORT=6379 npm start
node src/index.js --port 6379
node src/index.js 6379
```

## Test

```bash
npm test
```

Generates `test-reports/js-report.json` and `test-reports/js-report.txt`.

**Result**: 57/57 all pass.

## Structure

```
js/
├── src/
│   ├── index.js              # Entry point
│   ├── server.js             # TCP server + ClientState + auth
│   ├── protocol/
│   │   └── resp.js           # RESP2 parser & serializer
│   ├── commands/
│   │   ├── index.js          # CommandRouter
│   │   ├── string.js         # GET/SET/DEL/EXISTS/KEYS/MGET/INCRBY...
│   │   ├── hash.js           # HSET/HMSET/HGET/HGETALL/HDEL/HMGET...
│   │   ├── list.js           # LPUSH/RPUSH/LPOP/RPOP/LLEN/LRANGE...
│   │   ├── set.js            # SADD/SREM/SISMEMBER/SMEMBERS...
│   │   ├── zset.js           # ZADD/ZSCORE/ZRANGE/ZRANGEBYSCORE...
│   │   └── server.js         # PING/SELECT/AUTH/FLUSHDB/SCAN/INFO...
│   └── store/
│       ├── database.js       # Multi-DB in-memory store
│       └── expiry.js         # TTL expiry manager
└── test/
    ├── test-runner.js        # Orchestrator: start → test → report → stop
    └── suites/               # 6 test suites (string/hash/list/set/zset/server)
```

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `LIN_REDIS_PORT` | `6389` | Server port |
| `LIN_REDIS_HOST` | `127.0.0.1` | Bind address |
| `LIN_REDIS_PASSWORD` | `""` | AUTH password (empty = no auth) |

## Performance

- Single-threaded event loop, suitable for dev/local use
- Periodic expiry sweep every 100ms
- No persistence (纯内存缓存)
