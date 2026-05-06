module.exports = {
  name: 'ZSet Commands',

  tests: (r) => [
    { name: 'ZADD / ZSCORE', fn: async () => {
      await r.del('test:zset:1');
      let n = await r.zadd('test:zset:1', 1, 'one', 2, 'two', 3, 'three');
      if (n !== 3) throw new Error('Expected 3, got ' + n);
      const score = await r.zscore('test:zset:1', 'two');
      if (score !== '2') throw new Error('Expected 2, got ' + score);
    }},
    { name: 'ZRANGE', fn: async () => {
      await r.del('test:zset:2');
      await r.zadd('test:zset:2', 10, 'a', 20, 'b', 30, 'c');
      const range = await r.zrange('test:zset:2', 0, -1);
      if (range.length !== 3) throw new Error('Expected 3, got ' + range.length);
      if (range[0] !== 'a') throw new Error('Expected a, got ' + range[0]);
      if (range[2] !== 'c') throw new Error('Expected c, got ' + range[2]);
    }},
    { name: 'ZRANGE WITHSCORES', fn: async () => {
      await r.del('test:zset:3');
      await r.zadd('test:zset:3', 5, 'x', 10, 'y');
      const range = await r.zrange('test:zset:3', 0, -1, 'WITHSCORES');
      if (range.length !== 4) throw new Error('Expected 4 items, got ' + range.length);
      if (range[0] !== 'x') throw new Error('Expected x, got ' + range[0]);
      if (range[1] !== '5') throw new Error('Expected 5, got ' + range[1]);
    }},
    { name: 'ZRANGEBYSCORE', fn: async () => {
      await r.del('test:zset:4');
      await r.zadd('test:zset:4', 10, 'a', 20, 'b', 30, 'c', 40, 'd');
      const range = await r.zrangebyscore('test:zset:4', 15, 35);
      if (range.length !== 2) throw new Error('Expected 2, got ' + range.length);
      if (!range.includes('b')) throw new Error('Expected b, missing');
      if (!range.includes('c')) throw new Error('Expected c, missing');
    }},
    { name: 'ZRANGEBYSCORE WITHSCORES LIMIT', fn: async () => {
      await r.del('test:zset:5');
      await r.zadd('test:zset:5', 10, 'a', 20, 'b', 30, 'c', 40, 'd');
      const range = await r.zrangebyscore('test:zset:5', 10, 40, 'WITHSCORES', 'LIMIT', 1, 2);
      if (range.length !== 4) throw new Error('Expected 4 items, got ' + range.length);
    }},
    { name: 'okbang sentence length zset', fn: async () => {
      const key = 'okbang:bundle:category:greetings';
      await r.del(key);
      await r.zadd(key, 5, 'Hello', 6, 'World!', 12, 'How are you?');
      const range = await r.zrangebyscore(key, 5, 10);
      if (range.length !== 2) throw new Error('Expected 2 sentences, got ' + range.length);
    }},
    { name: 'ZREM', fn: async () => {
      await r.del('test:zset:rem');
      await r.zadd('test:zset:rem', 1, 'a', 2, 'b', 3, 'c');
      const n = await r.zrem('test:zset:rem', 'a', 'c');
      if (n !== 2) throw new Error('Expected 2, got ' + n);
      const range = await r.zrange('test:zset:rem', 0, -1);
      if (range.length !== 1) throw new Error('Expected 1 remaining, got ' + range.length);
    }},
    { name: 'ZCARD / ZCOUNT', fn: async () => {
      await r.del('test:zset:card');
      await r.zadd('test:zset:card', 10, 'a', 20, 'b', 30, 'c');
      const card = await r.zcard('test:zset:card');
      if (card !== 3) throw new Error('Expected 3, got ' + card);
      const count = await r.zcount('test:zset:card', 15, 25);
      if (count !== 1) throw new Error('Expected 1, got ' + count);
    }},
  ],
};
