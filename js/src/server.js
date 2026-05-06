const net = require('net');
const { RespParser, serializeSimpleString, serializeError } = require('./protocol/resp');
const { CommandRouter } = require('./commands/index');
const { registerStringCommands } = require('./commands/string');
const { registerHashCommands } = require('./commands/hash');
const { registerListCommands } = require('./commands/list');
const { registerSetCommands } = require('./commands/set');
const { registerZSetCommands } = require('./commands/zset');
const { registerServerCommands } = require('./commands/server');
const { Database } = require('./store/database');
const { ExpiryManager } = require('./store/expiry');

class ClientState {
  constructor(server, socket) {
    this.server = server;
    this.socket = socket;
    this.dbIndex = 0;
    this.authenticated = !server.requirePass;
    this.parser = new RespParser();
    this.buffer = '';
  }

  getDb() {
    return this.server.getDatabase(this.dbIndex);
  }

  selectDb(index) {
    if (!this.server.databases.has(index)) {
      this.server.databases.set(index, new Database(index));
    }
    this.dbIndex = index;
  }

  authenticate(password, username) {
    if (!this.server.requirePass) return true;
    if (password === this.server.password) {
      this.authenticated = true;
      return true;
    }
    return false;
  }

  handleData(data) {
    if (!this.authenticated) {
      this.buffer += data.toString('utf8');
      const lines = this.buffer.split('\r\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        const args = line.split(' ');
        if (args[0].toUpperCase() === 'AUTH') {
          const pw = args.length > 2 ? args[2] : args[1];
          const un = args.length > 2 ? args[1] : null;
          const result = this.authenticate(pw, un);
          if (result) {
            this.send(serializeSimpleString('OK'));
            this.parser.reset();
            this.buffer = '';
            return;
          }
          this.send(serializeError('NOAUTH Authentication required.'));
          continue;
        }
        this.send(serializeError('NOAUTH Authentication required.'));
      }
      return;
    }

    const commands = this.parser.feed(data);
    for (const cmd of commands) {
      this.handleCommand(cmd);
    }
  }

  handleCommand(cmd) {
    if (!Array.isArray(cmd) || cmd.length === 0) {
      this.send(serializeError('invalid command'));
      return;
    }

    const commandName = String(cmd[0]).toUpperCase();

    if (commandName === 'QUIT') {
      this.send(serializeSimpleString('OK'));
      this.socket.end();
      return;
    }

    const args = cmd.slice(1).map(a => String(a));
    const response = this.server.router.dispatch(this, commandName, args);
    this.send(response);
  }

  send(data) {
    if (this.socket.writable) {
      this.socket.write(data);
    }
  }
}

class LinRedisServer {
  constructor(options = {}) {
    this.port = options.port || 6379;
    this.host = options.host || '127.0.0.1';
    this.password = options.password || '';
    this.requirePass = !!this.password;
    this.databases = new Map();
    this.databases.set(0, new Database(0));
    this.router = new CommandRouter();
    this.expiryManager = new ExpiryManager(this.databases);
    this.server = null;
    this.clients = new Set();

    registerStringCommands(this.router);
    registerHashCommands(this.router);
    registerListCommands(this.router);
    registerSetCommands(this.router);
    registerZSetCommands(this.router);
    registerServerCommands(this.router);
  }

  getDatabase(index) {
    if (!this.databases.has(index)) {
      this.databases.set(index, new Database(index));
    }
    return this.databases.get(index);
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const client = new ClientState(this, socket);
        this.clients.add(client);

        socket.on('data', (data) => client.handleData(data));
        socket.on('error', (err) => {});
        socket.on('close', () => {
          this.clients.delete(client);
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.expiryManager.start();
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.expiryManager.stop();
      for (const client of this.clients) {
        try { client.socket.destroy(); } catch (e) {}
      }
      this.clients.clear();
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  getStats() {
    const cmdCount = this.router.getCommandCount();
    const expiryStats = this.expiryManager.getStats();
    let totalKeys = 0;
    for (const db of this.databases.values()) {
      totalKeys += db.strings.size + db.hashes.size + db.lists.size + db.sets.size + db.zsets.size;
    }
    return { cmdCount, expiryStats, totalKeys, clients: this.clients.size, dbCount: this.databases.size };
  }
}

module.exports = { LinRedisServer, ClientState };
