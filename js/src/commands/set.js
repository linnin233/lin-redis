const { serializeError, serializeInteger, serializeArray, serializeBulkString, serializeNull } = require('../protocol/resp');

function registerSetCommands(router) {
  router.register('SADD', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for SADD');
    const key = args[0];
    const members = args.slice(1);
    return serializeInteger(client.getDb().setAdd(key, members));
  });

  router.register('SREM', (client, args) => {
    if (args.length < 2) return serializeError('wrong number of arguments for SREM');
    const key = args[0];
    const members = args.slice(1);
    return serializeInteger(client.getDb().setRemove(key, members));
  });

  router.register('SISMEMBER', (client, args) => {
    if (args.length !== 2) return serializeError('wrong number of arguments for SISMEMBER');
    return serializeInteger(client.getDb().setIsMember(args[0], args[1]));
  });

  router.register('SMEMBERS', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for SMEMBERS');
    return serializeArray(client.getDb().setMembers(args[0]));
  });

  router.register('SCARD', (client, args) => {
    if (args.length !== 1) return serializeError('wrong number of arguments for SCARD');
    return serializeInteger(client.getDb().setMembers(args[0]).length);
  });

  router.register('SPOP', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for SPOP');
    const members = client.getDb().setMembers(args[0]);
    if (members.length === 0) return serializeNull();
    const idx = Math.floor(Math.random() * members.length);
    const member = members[idx];
    client.getDb().setRemove(args[0], [member]);
    return serializeBulkString(member);
  });

  router.register('SRANDMEMBER', (client, args) => {
    if (args.length < 1) return serializeError('wrong number of arguments for SRANDMEMBER');
    const members = client.getDb().setMembers(args[0]);
    if (members.length === 0) return serializeNull();
    const idx = Math.floor(Math.random() * members.length);
    return serializeBulkString(members[idx]);
  });
}

module.exports = { registerSetCommands };
