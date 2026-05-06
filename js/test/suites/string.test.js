module.exports = {
  name: 'String Commands',

  tests: (r) => [
    { name: 'SET basic', fn: async () => {
      const ok = await r.set('test:str:1', 'hello');
      if (ok !== 'OK') throw new Error(`Expected OK, got ${ok}`);
    }},
    { name: 'GET existing', fn: async () => {
      await r.set('test:str:2', 'world');
      const val = await r.get('test:str:2');
      if (val !== 'world') throw new Error(`Expected world, got ${val}`);
    }},
    { name: 'GET non-existing', fn: async () => {
      const val = await r.get('test:str:nonexist');
      if (val !== null) throw new Error(`Expected null, got ${val}`);
    }},
    { name: 'SET with EX', fn: async () => {
      await r.set('test:str:ex', 'expire', 'EX', 2);
      let val = await r.get('test:str:ex');
      if (val !== 'expire') throw new Error(`Expected expire, got ${val}`);
      await new Promise(resolve => setTimeout(resolve, 2500));
      val = await r.get('test:str:ex');
      if (val !== null) throw new Error(`Expected null after expiry, got ${val}`);
    }},
    { name: 'SETEX', fn: async () => {
      await r.setex('test:str:setex', 2, 'setexval');
      let val = await r.get('test:str:setex');
      if (val !== 'setexval') throw new Error(`Expected setexval, got ${val}`);
      await new Promise(resolve => setTimeout(resolve, 2500));
      val = await r.get('test:str:setex');
      if (val !== null) throw new Error(`Expected null after expiry, got ${val}`);
    }},
    { name: 'DEL single', fn: async () => {
      await r.set('test:str:del1', 'x');
      const n = await r.del('test:str:del1');
      if (n !== 1) throw new Error(`Expected 1, got ${n}`);
    }},
    { name: 'DEL multiple', fn: async () => {
      await r.set('test:str:del2', 'a');
      await r.set('test:str:del3', 'b');
      const n = await r.del('test:str:del2', 'test:str:del3');
      if (n !== 2) throw new Error(`Expected 2, got ${n}`);
    }},
    { name: 'EXISTS', fn: async () => {
      await r.set('test:str:exists1', 'yes');
      const e1 = await r.exists('test:str:exists1');
      const e2 = await r.exists('test:str:exists_nope');
      if (e1 !== 1) throw new Error(`Expected 1, got ${e1}`);
      if (e2 !== 0) throw new Error(`Expected 0, got ${e2}`);
    }},
    { name: 'EXPIRE', fn: async () => {
      await r.set('test:str:exp', 'ttl');
      const ok = await r.expire('test:str:exp', 1);
      if (ok !== 1) throw new Error(`Expected 1, got ${ok}`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      const val = await r.get('test:str:exp');
      if (val !== null) throw new Error(`Expected null after expire, got ${val}`);
    }},
    { name: 'INCR / INCRBY', fn: async () => {
      await r.set('test:str:counter', '10');
      let v = await r.incr('test:str:counter');
      if (v !== 11) throw new Error(`Expected 11, got ${v}`);
      v = await r.incrby('test:str:counter', 5);
      if (v !== 16) throw new Error(`Expected 16, got ${v}`);
      await r.set('test:str:empty', '0');
      v = await r.incrby('test:str:newkey', 3);
      if (v !== 3) throw new Error(`Expected 3 for new key, got ${v}`);
    }},
    { name: 'INCRBY with stats key pattern', fn: async () => {
      const key = 'stats:requests:1234567890:instance1';
      await r.set(key, '0');
      let v = await r.incrby(key, 1);
      if (v !== 1) throw new Error(`Expected 1, got ${v}`);
      v = await r.incrby(key, 5);
      if (v !== 6) throw new Error(`Expected 6, got ${v}`);
    }},
    { name: 'MGET', fn: async () => {
      await r.set('test:str:mg1', 'a');
      await r.set('test:str:mg2', 'b');
      const vals = await r.mget('test:str:mg1', 'test:str:mg2', 'test:str:mg_nope');
      if (vals[0] !== 'a') throw new Error(`Expected a, got ${vals[0]}`);
      if (vals[1] !== 'b') throw new Error(`Expected b, got ${vals[1]}`);
      if (vals[2] !== null) throw new Error(`Expected null, got ${vals[2]}`);
    }},
    { name: 'KEYS pattern', fn: async () => {
      await r.set('test:keys:alpha', '1');
      await r.set('test:keys:beta', '2');
      await r.set('test:other', '3');
      const keys = await r.keys('test:keys:*');
      if (keys.length !== 2) throw new Error(`Expected 2 keys, got ${keys.length}`);
      if (!keys.includes('test:keys:alpha')) throw new Error('Missing test:keys:alpha');
      if (!keys.includes('test:keys:beta')) throw new Error('Missing test:keys:beta');
    }},
    { name: 'okbang user:token pattern', fn: async () => {
      await r.set('user:token:abc123', '{"userId":1}');
      await r.set('user:token:def456', '{"userId":2}');
      await r.set('user:detail:admin:', '{"role":"admin"}');
      const tokens = await r.keys('user:token:*');
      if (tokens.length !== 2) throw new Error(`Expected 2 tokens, got ${tokens.length}`);
    }},
    { name: 'MSET', fn: async () => {
      await r.mset('test:mset:1', 'one', 'test:mset:2', 'two');
      const v1 = await r.get('test:mset:1');
      const v2 = await r.get('test:mset:2');
      if (v1 !== 'one') throw new Error(`Expected one, got ${v1}`);
      if (v2 !== 'two') throw new Error(`Expected two, got ${v2}`);
    }},
    { name: 'APPEND / STRLEN', fn: async () => {
      await r.set('test:append', 'hello');
      const len = await r.append('test:append', ' world');
      if (len !== 11) throw new Error(`Expected 11, got ${len}`);
      const val = await r.get('test:append');
      if (val !== 'hello world') throw new Error(`Expected 'hello world', got ${val}`);
    }},
    { name: 'DECR / DECRBY', fn: async () => {
      await r.set('test:decr', '10');
      let v = await r.decr('test:decr');
      if (v !== 9) throw new Error(`Expected 9, got ${v}`);
      v = await r.decrby('test:decr', 3);
      if (v !== 6) throw new Error(`Expected 6, got ${v}`);
    }},
    { name: 'TTL', fn: async () => {
      await r.set('test:ttl', 'val', 'EX', 100);
      const ttl = await r.ttl('test:ttl');
      if (ttl <= 0 || ttl > 100) throw new Error(`Expected TTL between 1-100, got ${ttl}`);
      const ttlNone = await r.ttl('test:ttl:nope');
      if (ttlNone !== -2) throw new Error(`Expected -2 for non-existing, got ${ttlNone}`);
    }},
    { name: 'SET NX / XX', fn: async () => {
      await r.del('test:nx');
      let ok = await r.set('test:nx', 'first', 'NX');
      if (ok !== 'OK') throw new Error(`NX should succeed, got ${ok}`);
      ok = await r.set('test:nx', 'second', 'NX');
      if (ok !== null) throw new Error(`NX should return null, got ${ok}`);
      ok = await r.set('test:nx', 'third', 'XX');
      if (ok !== 'OK') throw new Error(`XX should succeed, got ${ok}`);
      await r.del('test:xx');
      ok = await r.set('test:xx', 'val', 'XX');
      if (ok !== null) throw new Error(`XX should return null for non-existing, got ${ok}`);
    }},
  ],
};
