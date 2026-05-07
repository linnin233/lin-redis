/**
 * LinRedisServer - Redis 服务器实现（JavaScript 版）
 * 
 * 基于 Node.js net 模块实现的 Redis 服务器：
 * - TCP 服务器：监听指定端口，接收客户端连接
 * - RESP 协议：解析客户端请求，编码服务器响应
 * - 多数据库支持：Redis 支持 0-15 共16个数据库
 * - 认证机制：可选的密码认证（requirePass）
 * 
 * 核心组件：
 * - CommandRouter：命令路由器，分发命令到处理器
 * - Database：数据存储，支持5种数据类型
 * - ExpiryManager：过期键管理器
 * - ClientState：客户端状态管理
 * 
 * 架构设计：
 * - 单线程事件循环：Node.js 的异步 IO 模型
 * - 每个连接独立 ClientState：数据库选择、认证状态
 * - RESP 解析器：流式解析，支持 TCP 粘包/拆包
 */

const net = require('net'); // Node.js TCP 模块
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

/**
 * ClientState - 客户端状态管理类
 * 
 * 每个客户端连接创建一个 ClientState 实例，用于跟踪：
 * - 当前选择的数据库索引（dbIndex）
 * - 认证状态（authenticated）
 * - RESP 协议解析器（parser）
 * - 认证前的缓冲区（buffer）
 * 
 * 工作流程：
 * 1. 连接建立时创建 ClientState
 * 2. 接收数据 -> handleData() 处理
 * 3. 未认证时处理 AUTH 命令
 * 4. 已认证后解析 RESP 命令
 * 5. handleCommand() 路由命令并返回响应
 */
class ClientState {
  /**
   * 创建客户端状态
   * 
   * @param server - LinRedisServer 服务器实例
   * @param socket - net.Socket TCP 套接字
   */
  constructor(server, socket) {
    this.server = server;
    this.socket = socket;
    this.dbIndex = 0; // 默认数据库索引 0
    this.authenticated = !server.requirePass; // 如果不要求认证，默认已认证
    this.parser = new RespParser(); // RESP 协议解析器
    this.buffer = ''; // 认证前的文本缓冲区
  }

  /**
   * 获取当前选择的数据库实例
   * 
   * @returns Database 实例
   */
  getDb() {
    return this.server.getDatabase(this.dbIndex);
  }

  /**
   * SELECT 命令实现：切换数据库
   * 
   * @param index - 数据库索引（0-15）
   * 
   * 如果数据库不存在，自动创建
   */
  selectDb(index) {
    if (!this.server.databases.has(index)) {
      this.server.databases.set(index, new Database(index));
    }
    this.dbIndex = index;
  }

  /**
   * AUTH 命令实现：认证
   * 
   * @param password - 密码
   * @param username - 用户名（可选，Redis 6.0 ACL）
   * @returns 是否认证成功
   */
  authenticate(password, username) {
    if (!this.server.requirePass) return true; // 不要求认证
    if (password === this.server.password) {
      this.authenticated = true;
      return true;
    }
    return false;
  }

  /**
   * 处理接收到的数据
   * 
   * @param data - Buffer 接收的数据
   * 
   * 认证流程：
   * - 如果未认证，只处理 AUTH 命令
   * - 其他命令返回 NOAUTH 错误
   * - 使用文本缓冲区处理简单的 AUTH 命令
   * 
   * 命令流程：
   * - 已认证后，使用 RESP 解析器
   * - 解析命令数组，路由到处理器
   */
  handleData(data) {
    if (!this.authenticated) {
      // 未认证：处理简单的文本 AUTH 命令
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
            this.parser.reset(); // 清空解析器
            this.buffer = ''; // 清空缓冲区
            return;
          }
          this.send(serializeError('NOAUTH Authentication required.'));
          continue;
        }
        this.send(serializeError('NOAUTH Authentication required.'));
      }
      return;
    }

    // 已认证：解析 RESP 命令
    const commands = this.parser.feed(data);
    for (const cmd of commands) {
      this.handleCommand(cmd);
    }
  }

  /**
   * 处理单个命令
   * 
   * @param cmd - 命令数组 [commandName, arg1, arg2, ...]
   * 
   * 命令处理流程：
   * 1. 检查命令格式（必须是非空数组）
   * 2. 提取命令名（第一个元素）
   * 3. 特殊处理 QUIT 命令
   * 4. 提取参数并路由到处理器
   * 5. 返回响应
   */
  handleCommand(cmd) {
    if (!Array.isArray(cmd) || cmd.length === 0) {
      this.send(serializeError('invalid command'));
      return;
    }

    const commandName = String(cmd[0]).toUpperCase();

    if (commandName === 'QUIT') {
      this.send(serializeSimpleString('OK'));
      this.socket.end(); // 关闭连接
      return;
    }

    const args = cmd.slice(1).map(a => String(a)); // 提取参数
    const response = this.server.router.dispatch(this, commandName, args);
    this.send(response);
  }

  /**
   * 发送响应数据
   * 
   * @param data - RESP 格式的响应字符串
   */
  send(data) {
    if (this.socket.writable) {
      this.socket.write(data);
    }
  }
}

/**
 * LinRedisServer - 主服务器类
 * 
 * 服务器配置：
 * - port：监听端口（默认 6379，Redis 标准端口）
 * - host：监听地址（默认 127.0.0.1）
 * - password：可选认证密码
 * - requirePass：是否要求认证
 * 
 * 核心功能：
 * - 创建 TCP 服务器，监听客户端连接
 * - 管理多个数据库实例
 * - 路由命令到处理器
 * - 定期清理过期键
 * - 统计服务器状态
 * 
 * 启动流程：
 * 1. 创建 Database(0) 作为默认数据库
 * 2. 注册所有命令处理器
 * 3. 启动 ExpiryManager
 * 4. 创建 TCP 服务器并监听端口
 */
class LinRedisServer {
  /**
   * 创建服务器实例
   * 
   * @param options - 配置选项 {port, host, password}
   */
  constructor(options = {}) {
    this.port = options.port ?? 6379; // 支持端口 0 (随机)
    this.host = options.host || '127.0.0.1'; // 本地地址
    this.password = options.password || ''; // 认证密码
    this.requirePass = !!this.password; // 是否要求认证
    
    // 数据库集合：Map<index, Database>
    this.databases = new Map();
    this.databases.set(0, new Database(0)); // 创建默认数据库
    
    // 命令路由器
    this.router = new CommandRouter();
    
    // 过期键管理器
    this.expiryManager = new ExpiryManager(this.databases);
    
    this.server = null; // TCP 服务器实例
    this.clients = new Set(); // 客户端集合

    // 注册所有命令处理器
    registerStringCommands(this.router);
    registerHashCommands(this.router);
    registerListCommands(this.router);
    registerSetCommands(this.router);
    registerZSetCommands(this.router);
    registerServerCommands(this.router);
  }

  /**
   * 获取或创建数据库实例
   * 
   * @param index - 数据库索引
   * @returns Database 实例
   */
  getDatabase(index) {
    if (!this.databases.has(index)) {
      this.databases.set(index, new Database(index)); // 自动创建
    }
    return this.databases.get(index);
  }

  /**
   * 启动服务器
   * 
   * @returns Promise，启动成功时 resolve
   * 
   * 启动流程：
   * 1. 创建 TCP 服务器（net.createServer）
   * 2. 每个连接创建 ClientState
   * 3. 监听 data/error/close 事件
   * 4. 监听指定端口
   * 5. 启动过期键清理器
   */
  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const client = new ClientState(this, socket);
        this.clients.add(client); // 添加到客户端集合

        // 监听数据事件
        socket.on('data', (data) => client.handleData(data));
        
        // 错误处理（忽略错误，防止崩溃）
        socket.on('error', (err) => {});
        
        // 连接关闭时清理客户端
        socket.on('close', () => {
          this.clients.delete(client);
        });
      });

      this.server.on('error', reject); // 服务器错误
      this.server.listen(this.port, this.host, () => {
        this.expiryManager.start(); // 启动过期清理
        resolve(); // 启动成功
      });
    });
  }

  /**
   * 停止服务器
   * 
   * @returns Promise，关闭完成时 resolve
   * 
   * 关闭流程：
   * 1. 停止过期清理器
   * 2. 关闭所有客户端连接
   * 3. 关闭 TCP 服务器
   */
  stop() {
    return new Promise((resolve) => {
      this.expiryManager.stop(); // 停止过期清理
      
      // 关闭所有客户端连接
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

  /**
   * 获取服务器统计信息
   * 
   * @returns {cmdCount, expiryStats, totalKeys, clients, dbCount}
   * 
   * 统计内容：
   * - cmdCount：已注册命令数量
   * - expiryStats：过期清理统计
   * - totalKeys：总键数量
   * - clients：当前连接数
   * - dbCount：数据库数量
   */
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
