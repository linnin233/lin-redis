module.exports = {
  name: 'List Commands',

  tests: (r) => [
    { name: 'RPUSH / LRANGE', fn: async () => {
      await r.del('test:list:1');
      let len = await r.rpush('test:list:1', 'a', 'b', 'c');
      if (len !== 3) throw new Error('Expected 3, got ' + len);
      const range = await r.lrange('test:list:1', 0, -1);
      if (range.length !== 3) throw new Error('Expected 3 items, got ' + range.length);
      if (range[0] !== 'a') throw new Error('Expected a, got ' + range[0]);
      if (range[2] !== 'c') throw new Error('Expected c, got ' + range[2]);
    }},
    { name: 'LPUSH', fn: async () => {
      await r.del('test:list:2');
      let len = await r.lpush('test:list:2', 'c', 'b', 'a');
      if (len !== 3) throw new Error('Expected 3, got ' + len);
      const range = await r.lrange('test:list:2', 0, -1);
      if (range[0] !== 'a') throw new Error('Expected a first, got ' + range[0]);
    }},
    { name: 'LLEN', fn: async () => {
      await r.del('test:list:3');
      await r.rpush('test:list:3', 'x', 'y');
      const len = await r.llen('test:list:3');
      if (len !== 2) throw new Error('Expected 2, got ' + len);
    }},
    { name: 'LPOP', fn: async () => {
      await r.del('test:list:4');
      await r.rpush('test:list:4', '1', '2', '3');
      const val = await r.lpop('test:list:4');
      if (val !== '1') throw new Error('Expected 1, got ' + val);
      const remaining = await r.lrange('test:list:4', 0, -1);
      if (remaining.length !== 2) throw new Error('Expected 2 remaining, got ' + remaining.length);
    }},
    { name: 'RPOP', fn: async () => {
      await r.del('test:list:5');
      await r.rpush('test:list:5', 'a', 'b', 'c');
      const val = await r.rpop('test:list:5');
      if (val !== 'c') throw new Error('Expected c, got ' + val);
    }},
    { name: 'LRANGE with offsets', fn: async () => {
      await r.del('test:list:6');
      await r.rpush('test:list:6', '0', '1', '2', '3', '4');
      const range = await r.lrange('test:list:6', 1, 3);
      if (range.length !== 3) throw new Error('Expected 3, got ' + range.length);
      if (range[0] !== '1') throw new Error('Expected 1, got ' + range[0]);
    }},
    { name: 'RPUSH with okbang categoryEntities', fn: async () => {
      await r.del('categoryEntities');
      await r.rpush('categoryEntities', 'cat1', 'cat2', 'cat3');
      const all = await r.lrange('categoryEntities', 0, -1);
      if (all.length !== 3) throw new Error('Expected 3 categories, got ' + all.length);
    }},
    { name: 'LINDEX', fn: async () => {
      await r.del('test:list:idx');
      await r.rpush('test:list:idx', 'a', 'b', 'c');
      const val = await r.lindex('test:list:idx', 1);
      if (val !== 'b') throw new Error('Expected b, got ' + val);
    }},
    { name: 'LREM', fn: async () => {
      await r.del('test:list:rem');
      await r.rpush('test:list:rem', 'a', 'b', 'a', 'c', 'a');
      const n = await r.lrem('test:list:rem', 2, 'a');
      if (n !== 2) throw new Error('Expected 2 removed, got ' + n);
    }},
  ],
};
