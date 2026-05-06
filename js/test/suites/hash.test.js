module.exports = {
  name: 'Hash Commands',

  tests: (r) => [
    { name: 'HSET / HGET', fn: async () => {
      await r.hset('test:hash:1', 'name', 'Alice');
      const val = await r.hget('test:hash:1', 'name');
      if (val !== 'Alice') throw new Error('Expected Alice, got ' + val);
    }},
    { name: 'HMSET / HGETALL', fn: async () => {
      await r.hmset('test:hash:2', 'a', '1', 'b', '2', 'c', '3');
      const all = await r.hgetall('test:hash:2');
      if (all.a !== '1') throw new Error('Expected 1, got ' + all.a);
      if (all.b !== '2') throw new Error('Expected 2, got ' + all.b);
      if (all.c !== '3') throw new Error('Expected 3, got ' + all.c);
      if (Object.keys(all).length !== 3) throw new Error('Expected 3 fields, got ' + Object.keys(all).length);
    }},
    { name: 'HDEL', fn: async () => {
      await r.hset('test:hash:3', 'x', '10', 'y', '20');
      const n = await r.hdel('test:hash:3', 'x');
      if (n !== 1) throw new Error('Expected 1, got ' + n);
      const val = await r.hget('test:hash:3', 'x');
      if (val !== null) throw new Error('Expected null after delete, got ' + val);
    }},
    { name: 'HMGET', fn: async () => {
      await r.hset('test:hash:4', 'f1', 'v1', 'f2', 'v2');
      const vals = await r.hmget('test:hash:4', 'f1', 'f2', 'f3');
      if (vals[0] !== 'v1') throw new Error('Expected v1, got ' + vals[0]);
      if (vals[1] !== 'v2') throw new Error('Expected v2, got ' + vals[1]);
      if (vals[2] !== null) throw new Error('Expected null, got ' + vals[2]);
    }},
    { name: 'HEXISTS', fn: async () => {
      await r.hset('test:hash:5', 'field', 'val');
      const e1 = await r.hexists('test:hash:5', 'field');
      const e2 = await r.hexists('test:hash:5', 'nope');
      if (e1 !== 1) throw new Error('Expected 1, got ' + e1);
      if (e2 !== 0) throw new Error('Expected 0, got ' + e2);
    }},
    { name: 'HLEN', fn: async () => {
      await r.hset('test:hash:6', 'a', '1', 'b', '2');
      const len = await r.hlen('test:hash:6');
      if (len !== 2) throw new Error('Expected 2, got ' + len);
    }},
    { name: 'okbang HTTP log hash', fn: async () => {
      const key = 'log:v1:user:login:1234567890:99999';
      await r.hset(key, 'method', 'POST', 'url', '/api/login', 'status', '200', 'duration', '45');
      const all = await r.hgetall(key);
      if (all.method !== 'POST') throw new Error('Expected POST, got ' + all.method);
      if (all.status !== '200') throw new Error('Expected 200, got ' + all.status);
    }},
    { name: 'HSETNX', fn: async () => {
      await r.del('test:hash:nx');
      let ok = await r.hsetnx('test:hash:nx', 'field', 'first');
      if (ok !== 1) throw new Error('Expected 1, got ' + ok);
      ok = await r.hsetnx('test:hash:nx', 'field', 'second');
      if (ok !== 0) throw new Error('Expected 0, got ' + ok);
    }},
    { name: 'HKEYS / HVALS', fn: async () => {
      await r.hset('test:hash:kv', 'x', '10', 'y', '20');
      const keys = await r.hkeys('test:hash:kv');
      const vals = await r.hvals('test:hash:kv');
      if (keys.length !== 2) throw new Error('Expected 2 keys, got ' + keys.length);
      if (vals.length !== 2) throw new Error('Expected 2 vals, got ' + vals.length);
    }},
  ],
};
