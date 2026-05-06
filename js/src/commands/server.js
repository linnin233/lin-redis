const { serializeSimpleString, serializeError, serializeInteger, serializeArray, serializeBulkString, serializeNull } = require('../protocol/resp');

function registerServerCommands(router) {
  router.register('PING', (client, args) => {
    if (args.length === 0) return serializeSimpleString('PONG');
    return serializeBulkString(args[0]);
  });

  router.register('ECHO', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for ECHO');
    return serializeBulkString(args[0]);
  });

  router.register('SELECT', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for SELECT');
    const index = parseInt(args[0]);
    if (isNaN(index) || index < 0) return serializeError('invalid DB index');
    client.selectDb(index);
    return serializeSimpleString('OK');
  });

  router.register('AUTH', (client, args) => {
    const password = args.length > 1 ? args[1] : (args.length === 1 ? args[0] : '');
    const username = args.length > 1 ? args[0] : null;
    const result = client.authenticate(password, username);
    return result ? serializeSimpleString('OK') : serializeError('invalid password');
  });

  router.register('FLUSHDB', (client, args) => {
    client.getDb().flushDb();
    return serializeSimpleString('OK');
  });

  router.register('FLUSHALL', (client, args) => {
    for (const db of client.server.databases.values()) {
      db.flushDb();
    }
    return serializeSimpleString('OK');
  });

  router.register('SCAN', (client, args) => {
    let cursor = parseInt(args[0]);
    if (isNaN(cursor)) cursor = 0;

    let matchPattern = '*';
    let count = 10;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i].toUpperCase();
      if (arg === 'MATCH' && i + 1 < args.length) matchPattern = args[++i];
      else if (arg === 'COUNT' && i + 1 < args.length) count = parseInt(args[++i]);
    }

    const db = client.getDb();
    const allSets = [db.strings, db.hashes, db.lists, db.sets, db.zsets];
    const allKeys = new Set();
    for (const store of allSets) {
      for (const key of store.keys()) allKeys.add(key);
    }

    const regex = patternToRegex(matchPattern);
    const matching = [...allKeys].filter(k => regex.test(k)).sort();

    const startIdx = cursor;
    const batch = matching.slice(startIdx, startIdx + count);
    const nextCursor = startIdx + count >= matching.length ? 0 : startIdx + count;

    return serializeArray([String(nextCursor), batch]);
  });

  router.register('INFO', (client, args) => {
    const stats = client.server.expiryManager.getStats();
    let totalKeys = 0;
    for (const db of client.server.databases.values()) {
      totalKeys += db.strings.size + db.hashes.size + db.lists.size + db.sets.size + db.zsets.size;
    }
    const info = [
      '# Server',
      'lin-redis:1.0.0',
      'redis_version:6.0.0',
      '',
      '# Keyspace',
      `db0:keys=${totalKeys},expires=0`,
      '',
      '# Stats',
      `expired_keys:${stats.expired}`,
      `sweeps:${stats.sweeps}`,
    ];
    return serializeBulkString(info.join('\r\n'));
  });

  router.register('COMMAND', (client, args) => {
    return serializeArray([]);
  });

  router.register('CONFIG', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for CONFIG');
    const sub = args[0].toUpperCase();
    if (sub === 'SET') return serializeSimpleString('OK');
    if (sub === 'GET') {
      if (args[1] === '*') return serializeArray([]);
      return serializeArray([args[1], '']);
    }
    return serializeError('unsupported CONFIG subcommand');
  });

  router.register('DBSIZE', (client, args) => {
    const db = client.getDb();
    return serializeInteger(
      db.strings.size + db.hashes.size + db.lists.size + db.sets.size + db.zsets.size
    );
  });

  router.register('RANDOMKEY', (client, args) => {
    const db = client.getDb();
    const allKeys = [
      ...db.strings.keys(),
      ...db.hashes.keys(),
      ...db.lists.keys(),
      ...db.sets.keys(),
      ...db.zsets.keys()
    ];
    if (allKeys.length === 0) return serializeNull();
    return serializeBulkString(allKeys[Math.floor(Math.random() * allKeys.length)]);
  });

  router.register('QUIT', (client, args) => {
    return serializeSimpleString('OK');
  });
}

function patternToRegex(pattern) {
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    switch (ch) {
      case '*': regexStr += '.*'; break;
      case '?': regexStr += '.'; break;
      case '[': {
        let j = i + 1;
        while (j < pattern.length && pattern[j] !== ']') j++;
        if (j < pattern.length) { regexStr += pattern.substring(i, j + 1); i = j; }
        else regexStr += '\\[';
        break;
      }
      case '\\': regexStr += '\\\\'; break;
      case '.': regexStr += '\\.'; break;
      case '+': regexStr += '\\+'; break;
      case '^': regexStr += '\\^'; break;
      case '$': regexStr += '\\$'; break;
      case '|': regexStr += '\\|'; break;
      case '(': regexStr += '\\('; break;
      case ')': regexStr += '\\)'; break;
      case '{': regexStr += '\\{'; break;
      case '}': regexStr += '\\}'; break;
      default: regexStr += ch;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
}

module.exports = { registerServerCommands };
