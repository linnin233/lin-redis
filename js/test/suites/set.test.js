module.exports = {
  name: 'Set Commands',

  tests: (r) => [
    { name: 'SADD / SMEMBERS', fn: async () => {
      await r.del('test:set:1');
      let n = await r.sadd('test:set:1', 'a', 'b', 'c');
      if (n !== 3) throw new Error('Expected 3, got ' + n);
      n = await r.sadd('test:set:1', 'a');
      if (n !== 0) throw new Error('Expected 0 for duplicate, got ' + n);
      const members = await r.smembers('test:set:1');
      if (members.length !== 3) throw new Error('Expected 3 members, got ' + members.length);
    }},
    { name: 'SISMEMBER', fn: async () => {
      await r.del('test:set:2');
      await r.sadd('test:set:2', 'member1');
      const yes = await r.sismember('test:set:2', 'member1');
      const no = await r.sismember('test:set:2', 'member2');
      if (yes !== 1) throw new Error('Expected 1, got ' + yes);
      if (no !== 0) throw new Error('Expected 0, got ' + no);
    }},
    { name: 'SREM', fn: async () => {
      await r.del('test:set:3');
      await r.sadd('test:set:3', 'x', 'y', 'z');
      const n = await r.srem('test:set:3', 'x', 'z');
      if (n !== 2) throw new Error('Expected 2, got ' + n);
      const members = await r.smembers('test:set:3');
      if (members.length !== 1) throw new Error('Expected 1 member, got ' + members.length);
    }},
    { name: 'SCARD', fn: async () => {
      await r.del('test:set:4');
      await r.sadd('test:set:4', '1', '2', '3', '4', '5');
      const n = await r.scard('test:set:4');
      if (n !== 5) throw new Error('Expected 5, got ' + n);
    }},
  ],
};
