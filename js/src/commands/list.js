const { serializeError, serializeInteger, serializeBulkString, serializeArray, serializeNull, serializeSimpleString } = require('../protocol/resp');

function registerListCommands(router) {
  router.register('LPUSH', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for LPUSH');
    const key = args[0];
    const values = args.slice(1);
    const len = client.getDb().listLPush(key, values);
    return serializeInteger(len);
  });

  router.register('RPUSH', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for RPUSH');
    const key = args[0];
    const values = args.slice(1);
    const len = client.getDb().listRPush(key, values);
    return serializeInteger(len);
  });

  router.register('LPOP', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for LPOP');
    let count = 1;
    if (args.length > 1) count = parseInt(args[1]);
    const db = client.getDb();
    if (count === 1) {
      const val = db.listLPop(args[0]);
      return val === null ? serializeNull() : serializeBulkString(val);
    }
    const result = [];
    for (let i = 0; i < count; i++) {
      const val = db.listLPop(args[0]);
      if (val === null) break;
      result.push(val);
    }
    return serializeArray(result);
  });

  router.register('RPOP', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for RPOP');
    let count = 1;
    if (args.length > 1) count = parseInt(args[1]);
    const db = client.getDb();
    if (count === 1) {
      const val = db.listRPop(args[0]);
      return val === null ? serializeNull() : serializeBulkString(val);
    }
    const result = [];
    for (let i = 0; i < count; i++) {
      const val = db.listRPop(args[0]);
      if (val === null) break;
      result.push(val);
    }
    return serializeArray(result);
  });

  router.register('LLEN', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for LLEN');
    return serializeInteger(client.getDb().listLen(args[0]));
  });

  router.register('LRANGE', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for LRANGE');
    const start = parseInt(args[1]);
    const stop = parseInt(args[2]);
    const result = client.getDb().listRange(args[0], start, stop);
    return serializeArray(result);
  });

  router.register('LINDEX', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for LINDEX');
    const index = parseInt(args[1]);
    const result = client.getDb().listRange(args[0], index, index);
    if (result.length === 0) return serializeNull();
    return serializeBulkString(result[0]);
  });

  router.register('LSET', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for LSET');
    const index = parseInt(args[1]);
    const db = client.getDb();
    const list = db.lists.get(args[0]);
    if (!list || index < 0 || index >= list.value.length) return serializeError('index out of range');
    list.value[index] = args[2];
    return serializeSimpleString('OK');
  });

  router.register('LREM', (client, args) => {
    if (args.length !== 3) return serializeError('wrong number of arguments for LREM');
    const count = parseInt(args[1]);
    const db = client.getDb();
    const list = db.lists.get(args[0]);
    if (!list) return serializeInteger(0);
    let removed = 0;
    if (count === 0) {
      list.value = list.value.filter(v => {
        if (v === args[2]) { removed++; return false; }
        return true;
      });
    } else if (count > 0) {
      for (let i = 0; i < list.value.length && removed < count; i++) {
        if (list.value[i] === args[2]) {
          list.value.splice(i, 1);
          removed++;
          i--;
        }
      }
    } else {
      for (let i = list.value.length - 1; i >= 0 && removed < -count; i--) {
        if (list.value[i] === args[2]) {
          list.value.splice(i, 1);
          removed++;
        }
      }
    }
    return serializeInteger(removed);
  });
}

module.exports = { registerListCommands };
