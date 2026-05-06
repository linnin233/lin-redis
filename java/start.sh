#!/bin/bash
cd "$(dirname "$0")"
PORT=${LIN_REDIS_PORT:-6389}
HOST=${LIN_REDIS_HOST:-127.0.0.1}
PASSWORD=${LIN_REDIS_PASSWORD:-}

export LIN_REDIS_PORT=$PORT
export LIN_REDIS_HOST=$HOST
export LIN_REDIS_PASSWORD=$PASSWORD

mvn -q exec:java -Dexec.mainClass="cn.linnin.linredis.LinRedisApplication"
