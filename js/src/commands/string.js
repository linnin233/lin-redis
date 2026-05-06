const { serializeSimpleString, serializeError, serializeInteger, serializeBulkString, serializeArray, serializeNull } = require('../protocol/resp');

function registerStringCommands(router) {
  router.register('SET', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for SET');
    const key = args[0];
    const value = args[1];

    let ttlMs = 0;
    let nx = false, xx = false, get = false, keepttl = false;

    for (let i = 2; i < args.length; i++) {
      const arg = args[i].toUpperCase();
      switch (arg) {
        case 'EX':
          ttlMs = parseInt(args[++i]) * 1000;
          break;
        case 'PX':
          ttlMs = parseInt(args[++i]);
          break;
        case 'EXAT':
          ttlMs = parseInt(args[++i]) * 1000 - Date.now();
          break;
        case 'PXAT':
          ttlMs = parseInt(args[++i]) - Date.now();
          break;
        case 'NX':
          nx = true;
          break;
        case 'XX':
          xx = true;
          break;
        case 'GET':
          get = true;
          break;
        case 'KEEPTTL':
          keepttl = true;
          break;
      }
    }

    const db = client.getDb();
    if (nx && db.existsKey(key)) return serializeNull();
    if (xx && !db.existsKey(key)) return serializeNull();
    if (get) {
      const oldVal = db.getString(key);
      db.setString(key, value, ttlMs);
      return oldVal === undefined ? serializeNull() : serializeBulkString(oldVal);
    }
    db.setString(key, value, ttlMs);
    return serializeSimpleString('OK');
  });

  router.register('GET', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for GET');
    const val = client.getDb().getString(args[0]);
    return val === undefined ? serializeNull() : serializeBulkString(val);
  });

  router.register('GETSET', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for GETSET');
    const db = client.getDb();
    const old = db.getString(args[0]);
    db.setString(args[0], args[1], 0);
    return old === undefined ? serializeNull() : serializeBulkString(old);
  });

  router.register('SETEX', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for SETEX');
    const seconds = parseInt(args[1]);
    client.getDb().setString(args[0], args[2], seconds * 1000);
    return serializeSimpleString('OK');
  });

  router.register('SETNX', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for SETNX');
    const db = client.getDb();
    if (db.existsKey(args[0])) return serializeInteger(0);
    db.setString(args[0], args[1], 0);
    return serializeInteger(1);
  });

  router.register('DEL', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for DEL');
    const count = client.getDb().deleteKeys(args);
    return serializeInteger(count);
  });

  router.register('EXISTS', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for EXISTS');
    let count = 0;
    const db = client.getDb();
    for (const key of args) {
      if (db.existsKey(key)) count++;
    }
    return serializeInteger(count);
  });

  router.register('EXPIRE', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for EXPIRE');
    const seconds = parseInt(args[1]);
    const result = client.getDb().expireKey(args[0], seconds * 1000);
    return serializeInteger(result);
  });

  router.register('EXPIREAT', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for EXPIREAT');
    const timestamp = parseInt(args[1]) * 1000;
    const entry = client.getDb().strings.get(args[0]);
    if (!entry) return serializeInteger(0);
    entry._expiry = timestamp;
    return serializeInteger(1);
  });

  router.register('TTL', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for TTL');
    const entry = client.getDb().strings.get(args[0]);
    if (!entry) return serializeInteger(-2);
    if (!entry._expiry) return serializeInteger(-1);
    const ttl = Math.ceil((entry._expiry - Date.now()) / 1000);
    return serializeInteger(ttl >= 0 ? ttl : -2);
  });

  router.register('INCR', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for INCR');
    const db = client.getDb();
    const val = db.getString(args[0]);
    const num = (val === undefined ? 0 : parseInt(val)) + 1;
    if (isNaN(num)) return serializeError('value is not an integer');
    db.setString(args[0], String(num), 0);
    return serializeInteger(num);
  });

  router.register('INCRBY', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for INCRBY');
    const db = client.getDb();
    const val = db.getString(args[0]);
    const increment = parseInt(args[1]);
    const num = (val === undefined ? 0 : parseInt(val)) + increment;
    if (isNaN(num) || isNaN(increment)) return serializeError('value is not an integer');
    db.setString(args[0], String(num), 0);
    return serializeInteger(num);
  });

  router.register('DECR', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for DECR');
    const db = client.getDb();
    const val = db.getString(args[0]);
    const num = (val === undefined ? 0 : parseInt(val)) - 1;
    if (isNaN(num)) return serializeError('value is not an integer');
    db.setString(args[0], String(num), 0);
    return serializeInteger(num);
  });

  router.register('DECRBY', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for DECRBY');
    const db = client.getDb();
    const val = db.getString(args[0]);
    const decrement = parseInt(args[1]);
    const num = (val === undefined ? 0 : parseInt(val)) - decrement;
    if (isNaN(num) || isNaN(decrement)) return serializeError('value is not an integer');
    db.setString(args[0], String(num), 0);
    return serializeInteger(num);
  });

  router.register('MGET', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for MGET');
    const db = client.getDb();
    const result = args.map(key => {
      const val = db.getString(key);
      return val === undefined ? null : val;
    });
    return serializeArray(result);
  });

  router.register('MSET', (client, args) => {
    if (args.length < 2 || args.length % 2 !== 0) return serializeError('wrong number of arguments for MSET');
    const db = client.getDb();
    for (let i = 0; i < args.length; i += 2) {
      db.setString(args[i], args[i + 1], 0);
    }
    return serializeSimpleString('OK');
  });

  router.register('KEYS', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for KEYS');
    const keys = client.getDb().keysByPattern(args[0]);
    return serializeArray(keys);
  });

  router.register('TYPE', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for TYPE');
    return serializeSimpleString(client.getDb().keyType(args[0]));
  });

  router.register('STRLEN', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for STRLEN');
    const val = client.getDb().getString(args[0]);
    if (val === undefined) return serializeInteger(0);
    return serializeInteger(Buffer.byteLength(val, 'utf8'));
  });

  router.register('APPEND', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for APPEND');
    const db = client.getDb();
    const existing = db.getString(args[0]) || '';
    const newVal = existing + args[1];
    db.setString(args[0], newVal, 0);
    return serializeInteger(Buffer.byteLength(newVal, 'utf8'));
  });
}

module.exports = { registerStringCommands };
