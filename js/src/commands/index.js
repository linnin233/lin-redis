const { serializeError } = require('../protocol/resp');

class CommandRouter {
  constructor() {
    this.commands = new Map();
  }

  register(name, handler) {
    this.commands.set(name.toUpperCase(), handler);
  }

  dispatch(client, commandName, args) {
    const handler = this.commands.get(commandName);
    if (!handler) {
      return serializeError(`unknown command '${commandName}'`);
    }
    try {
      return handler(client, args);
    } catch (err) {
      return serializeError(`ERR ${err.message}`);
    }
  }

  getCommandCount() {
    return this.commands.size;
  }
}

module.exports = { CommandRouter };
