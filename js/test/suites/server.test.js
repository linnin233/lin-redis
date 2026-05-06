module.exports = {
  name: 'Server Commands',

  tests: (r) => [
    { name: 'PING', fn: async () => {
      const pong = await r.ping();
      if (pong !== 'PONG') throw new Error('Expected PONG, got ' + pong);
    }},
    { name: 'SELECT / FLUSHDB', fn: async () => {
      await r.select(5);
      await r.set('test:db5:key', 'value');
      let val = await r.get('test:db5:key');
      if (val !== 'value') throw new Error('Expected value in DB5, got ' + val);
      await r.select(0);
      val = await r.get('test:db5:key');
      if (val !== null) throw new Error('Expected null in DB0, got ' + val);
      await r.select(5);
      await r.flushdb();
      val = await r.get('test:db5:key');
      if (val !== null) throw new Error('Expected null after FLUSHDB, got ' + val);
      await r.select(0);
    }},
    { name: 'SCAN', fn: async () => {
      await r.set('test:scan:1', 'a');
      await r.set('test:scan:2', 'b');
      const [cursor, keys] = await r.scan(0, 'MATCH', 'test:scan:*', 'COUNT', 10);
      if (!Array.isArray(keys)) throw new Error('Expected keys array, got ' + typeof keys);
      if (keys.length < 2) throw new Error('Expected at least 2 keys, got ' + keys.length);
    }},
    { name: 'DBSIZE', fn: async () => {
      await r.set('test:dbsize:1', 'x');
      const size = await r.dbsize();
      if (size < 1) throw new Error('Expected at least 1, got ' + size);
    }},
    { name: 'INFO', fn: async () => {
      const info = await r.info();
      if (typeof info !== 'string') throw new Error('Expected string from INFO');
      if (!info.includes('lin-redis')) throw new Error('Expected lin-redis in INFO output');
    }},
    { name: 'MULTI Database', fn: async () => {
      await r.select(9);
      await r.set('db9:key', 'val9');
      let v = await r.get('db9:key');
      if (v !== 'val9') throw new Error('Expected val9 in DB9, got ' + v);
      await r.select(10);
      await r.set('db10:key', 'val10');
      v = await r.get('db10:key');
      if (v !== 'val10') throw new Error('Expected val10 in DB10, got ' + v);
      v = await r.get('db9:key');
      if (v !== null) throw new Error('DB9 key should be null in DB10, got ' + v);
      await r.select(0);
    }},
    { name: 'okbang DB pattern test (0/9/10/11/12)', fn: async () => {
      const dbs = [0, 9, 10, 11, 12];
      for (const db of dbs) {
        await r.select(db);
        await r.set('okbang:test:db' + db, 'val');
        const v = await r.get('okbang:test:db' + db);
        if (v !== 'val') throw new Error('DB' + db + ' failed');
      }
      await r.select(0);
    }},
    { name: 'CONDITIONAL auth bypass', fn: async () => {
      const pong = await r.ping();
      if (pong !== 'PONG') throw new Error('Expected PONG without auth, got ' + pong);
    }},
  ],
};
