const { serializeError, serializeInteger, serializeBulkString, serializeArray, serializeNull } = require('../protocol/resp');

function registerZSetCommands(router) {
  router.register('ZADD', (client, args) => {
    if (args.length < 3) return serializeError('wrong number of arguments for ZADD');

    const key = args[0];
    let i = 1;

    let nx = false, xx = false, ch = false, incr = false;

    while (i < args.length) {
      const arg = args[i].toUpperCase();
      if (arg === 'NX') { nx = true; i++; }
      else if (arg === 'XX') { xx = true; i++; }
      else if (arg === 'CH') { ch = true; i++; }
      else if (arg === 'INCR') { incr = true; i++; }
      else break;
    }

    if (incr) {
      if (args.length - i !== 2) return serializeError('wrong number of arguments for ZADD INCR');
      const score = parseFloat(args[i]);
      const member = args[i + 1];
      const db = client.getDb();
      const existing = db.zsetScore(key, member);

      if (nx && existing !== null) return serializeNull();
      if (xx && existing === null) return serializeNull();

      const newScore = existing !== null ? existing + score : score;
      const added = db.zsetAdd(key, [{ score: newScore, member }]);
      return serializeBulkString(String(newScore));
    }

    const scoreMembers = [];
    while (i < args.length) {
      const score = parseFloat(args[i]);
      const member = args[i + 1];
      if (isNaN(score)) return serializeError('not a valid float');
      scoreMembers.push({ score, member });
      i += 2;
    }

    let added = client.getDb().zsetAdd(key, scoreMembers);
    return serializeInteger(added);
  });

  router.register('ZSCORE', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for ZSCORE');
    const score = client.getDb().zsetScore(args[0], args[1]);
    return score === null ? serializeNull() : serializeBulkString(String(score));
  });

  router.register('ZRANGE', (client, args) => {
    if (args.length < 3) return serializeError('wrong number of arguments for ZRANGE');
    const start = parseInt(args[1]);
    const stop = parseInt(args[2]);
    let withScores = false;
    for (let i = 3; i < args.length; i++) {
      if (args[i].toUpperCase() === 'WITHSCORES') withScores = true;
    }
    const result = client.getDb().zsetRange(args[0], start, stop, withScores);
    return serializeArray(result);
  });

  router.register('ZRANGEBYSCORE', (client, args) => {
    if (args.length < 3) return serializeError('wrong number of arguments for ZRANGEBYSCORE');

    const key = args[0];
    let min, max;

    if (args[1] === '-inf') min = '-inf';
    else if (args[1].startsWith('(')) min = parseFloat(args[1].substring(1)) + 0.000001;
    else min = parseFloat(args[1]);

    if (args[2] === '+inf') max = '+inf';
    else if (args[2].startsWith('(')) max = parseFloat(args[2].substring(1)) - 0.000001;
    else max = parseFloat(args[2]);

    let withScores = false;
    let offset = 0;
    let count = -1;

    for (let i = 3; i < args.length; i++) {
      const arg = args[i].toUpperCase();
      if (arg === 'WITHSCORES') withScores = true;
      else if (arg === 'LIMIT' && i + 2 < args.length) {
        offset = parseInt(args[++i]);
        count = parseInt(args[++i]);
      }
    }

    const result = client.getDb().zsetRangeByScore(args[0], min, max, withScores, offset, count);
    return serializeArray(result);
  });

  router.register('ZCARD', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for ZCARD');
    const entry = client.getDb().zsets.get(args[0]);
    return serializeInteger(entry ? entry.value.size : 0);
  });

  router.register('ZREM', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for ZREM');
    const key = args[0];
    const db = client.getDb();
    const entry = db.zsets.get(key);
    if (!entry) return serializeInteger(0);
    let removed = 0;
    for (let i = 1; i < args.length; i++) {
      if (entry.value.delete(args[i])) removed++;
    }
    if (entry.value.size === 0) db.zsets.delete(key);
    return serializeInteger(removed);
  });

  router.register('ZCOUNT', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for ZCOUNT');

    let min, max;
    if (args[1] === '-inf') min = -Infinity;
    else if (args[1].startsWith('(')) min = parseFloat(args[1].substring(1)) + 0.000001;
    else min = parseFloat(args[1]);

    if (args[2] === '+inf') max = Infinity;
    else if (args[2].startsWith('(')) max = parseFloat(args[2].substring(1)) - 0.000001;
    else max = parseFloat(args[2]);

    const entry = client.getDb().zsets.get(args[0]);
    if (!entry) return serializeInteger(0);
    let count = 0;
    for (const score of entry.value.values()) {
      if (score >= min && score <= max) count++;
    }
    return serializeInteger(count);
  });
}

module.exports = { registerZSetCommands };
