#!/bin/bash
# Start lin-redis server
kill $(lsof -t -i:6379) 2>/dev/null
kill $(lsof -t -i:8081) 2>/dev/null
sleep 0.3

# Start lin-redis (Node.js)
cd /home/linnin233/code/lin-redis/js
nohup env LIN_REDIS_PORT=6379 node src/index.js > /tmp/lin-redis.log 2>&1 &
echo "lin-redis PID: $!"

# Start redis-commander
cd /home/linnin233/code/lin-redis/tools
nohup npx redis-commander --redis-port 6379 --redis-host 127.0.0.1 --port 8081 > /tmp/redis-commander.log 2>&1 &
echo "redis-commander PID: $!"

sleep 2
lsof -i:6379 | grep LISTEN && echo "lin-redis: OK" || echo "lin-redis: FAIL"
lsof -i:8081 | grep LISTEN && echo "redis-commander: OK" || echo "redis-commander: FAIL"
curl -s -o /dev/null -w "HTTP: %{http_code}\n" http://127.0.0.1:8081
echo "Open: http://127.0.0.1:8081"
