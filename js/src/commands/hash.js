const { serializeSimpleString, serializeError, serializeInteger, serializeBulkString, serializeNull, serializeArray } = require('../protocol/resp');

function registerHashCommands(router) {
  router.register('HSET', (client, args) => {
    if (args.length < 3 || args.length % 2 !== 1) return serializeError('wrong number of arguments for HSET');
    const key = args[0];
    const db = client.getDb();
    let count = 0;
    for (let i = 1; i < args.length; i += 2) {
      const existed = db.getHashField(key, args[i]) !== null;
      db.setHashField(key, args[i], args[i + 1]);
      if (!existed) count++;
    }
    return serializeInteger(count);
  });

  router.register('HMSET', (client, args) => {
    if (args.length < 3 || args.length % 2 !== 1) return serializeError('wrong number of arguments for HMSET');
    const key = args[0];
    const db = client.getDb();
    for (let i = 1; i < args.length; i += 2) {
      db.setHashField(key, args[i], args[i + 1]);
    }
    return serializeSimpleString('OK');
  });

  router.register('HGET', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for HGET');
    const val = client.getDb().getHashField(args[0], args[1]);
    return val === null ? serializeNull() : serializeBulkString(val);
  });

  router.register('HGETALL', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for HGETALL');
    const map = client.getDb().getHashAll(args[0]);
    const result = [];
    for (const [k, v] of map) {
      result.push(k, v);
    }
    return serializeArray(result);
  });

  router.register('HDEL', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for HDEL');
    const key = args[0];
    const db = client.getDb();
    let count = 0;
    for (let i = 1; i < args.length; i++) {
      count += db.delHashField(key, args[i]);
    }
    return serializeInteger(count);
  });

  router.register('HMGET', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for HMGET');
    const key = args[0];
    const fields = args.slice(1);
    const values = client.getDb().getMultiHashFields(key, fields);
    return serializeArray(values);
  });

  router.register('HEXISTS', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for HEXISTS');
    const val = client.getDb().getHashField(args[0], args[1]);
    return serializeInteger(val !== null ? 1 : 0);
  });

  router.register('HLEN', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for HLEN');
    const map = client.getDb().getHashAll(args[0]);
    return serializeInteger(map.size);
  });

  router.register('HKEYS', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for HKEYS');
    const map = client.getDb().getHashAll(args[0]);
    return serializeArray([...map.keys()]);
  });

  router.register('HVALS', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for HVALS');
    const map = client.getDb().getHashAll(args[0]);
    return serializeArray([...map.values()]);
  });

  router.register('HSETNX', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for HSETNX');
    const db = client.getDb();
    const exists = db.getHashField(args[0], args[1]);
    if (exists !== null) return serializeInteger(0);
    db.setHashField(args[0], args[1], args[2]);
    return serializeInteger(1);
  });
}

module.exports = { registerHashCommands };
