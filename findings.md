# 发现与决策

## 需求
- 为 JS 和 Java 代码添加中文注释
- 详细解释实现原理

## 研究发现

### 项目结构
**JavaScript 实现（js/目录）：**
- `src/protocol/resp.js` - RESP 协议解析器
- `src/store/database.js` - 数据存储
- `src/store/expiry.js` - 过期时间管理
- `src/commands/` - 各种命令实现（string, hash, list, set, zset, server）
- `src/server.js` - TCP 服务器
- `src/index.js` - 入口文件

**Java 实现（java/目录）：**
- `protocol/RespDecoder.java` - RESP 协议解码器
- `protocol/RespEncoder.java` - RESP 协议编码器
- `store/Database.java` - 数据存储
- `store/ClientState.java` - 客户端状态
- `command/` - 各种命令处理器
- `server/RedisServer.java` - Netty 服务器
- `server/RedisChannelHandler.java` - 请求处理器

### 实现原理（详细分析）

#### RESP 协议（REdis Serialization Protocol）

**协议类型：**
- 简单字符串（Simple String）：`+OK\r\n` - 用于简单状态回复
- 错误（Error）：`-ERR message\r\n` - 用于错误消息
- 整数（Integer）：`:100\r\n` - 用于整数回复
- 批量字符串（Bulk String）：`$6\r\nfoobar\r\n` - 用于字符串数据，$-1 表示 null
- 数组（Array）：`*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n` - 用于批量命令参数

**JS 实现（resp.js）：**
- RespParser 类：流式解析器（streaming parser），支持增量解析
- feed() 方法：接收数据并尝试解析完整命令
- tryParse() 方法：尝试从 buffer 中解析一个完整的 RESP 值
- _parseValue() 方法：根据类型标识符（+, -, :, $, *）调用相应解析方法
- 关键特性：支持 TCP 粘包/拆包，数据可能分多次到达

**Java 实现（RespDecoder/RespEncoder）：**
- RespDecoder 继承 ByteToMessageDecoder：Netty 的解码器基类
- decode() 方法：自动处理粘包拆包，成功解析后添加到 out 列表
- indexOfCRLF() 方法：查找分隔符 \r\n
- RespEncoder 继承 MessageToByteEncoder：将对象编码为 RESP 格式
- 关键特性：利用 Netty 的零拷贝和 ByteBuf 高效处理

#### 数据存储结构

**Database 类核心设计：**
- 5种数据类型分别存储在不同 Map 中：
  - strings: 存储字符串键值对
  - hashes: Map<key, Map<field, value>> - 存储哈希表
  - lists: Map<key, Array/ArrayList> - 存储列表
  - sets: Map<key, Set> - 存储集合
  - zsets: Map<key, Map<member, score>> - 存储有序集合

**过期机制实现：**
- JS: entry 对象包含 _expiry 字段（过期时间戳）
- Java: StringEntry 类包含 expiry 字段
- ExpiryManager（JS）/ ScheduledExecutorService（Java）：定时扫描清理过期键
- 惰性过期：访问时检查过期时间，如果过期则删除

**包装/解包机制（_wrapValue/_unwrapEntry）：**
- _wrapValue: 创建带过期时间的 entry 对象
- _unwrapEntry: 检查过期并返回值，如果过期返回 undefined/null

#### 命令处理流程

**完整流程：**
1. 客户端发送 RESP 协议数据（如：`*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n`）
2. 协议解析器解码数据，提取命令名和参数数组
3. CommandRouter 根据命令名查找处理器
4. 命令处理器调用 Database 方法执行操作
5. 结果通过协议编码器编码为 RESP 格式返回

**CommandRouter 设计：**
- JS: 使用 Map 存储命令处理器函数
- Java: 使用 ConcurrentHashMap，线程安全
- dispatch() 方法：路由命令到处理器
- register() 方法：注册命令处理器

**关键命令实现：**
- SET: 支持 EX/PX/EXAT/PXAT/NX/XX/GET/KEEPTTL 选项
- GET: 简单查询，检查过期后返回
- INCR/DECR: 整数操作，原子性递增/递减
- HSET/HGET: 哈希表操作
- LPUSH/RPUSH: 列表头部/尾部插入
- ZADD/ZRANGE: 有序集合，按分数排序

#### 服务器架构

**JavaScript 实现（Node.js net 模块）：**
- LinRedisServer: 主服务器类
- ClientState: 每个连接的状态对象，包含数据库索引、认证状态
- handleData(): 处理接收数据，支持认证流程
- handleCommand(): 解析并路由命令
- ExpiryManager: 定时清理过期键（setInterval）

**Java 实现（Netty 框架）：**
- RedisServer: 主服务器类，配置 ServerBootstrap
- RedisChannelHandler: ChannelHandler，处理每个连接
- ClientState: 客户端状态，包含当前数据库索引
- Boss Group + Worker Group: Reactor 模型，处理并发连接
- ScheduledExecutorService: 定时清理过期键

**认证机制：**
- 如果设置密码，客户端必须先 AUTH 才能执行命令
- 未认证时只处理 AUTH 命令，其他命令返回 NOAUTH 错误

## 技术决策
| 决策 | 理由 |
|------|------|
| 先读取代码理解实现 | 确保注释准确 |
| 为核心数据结构添加详细注释 | 理解存储机制是关键 |
| 为协议层添加详细注释 | 协议是通信基础 |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| - | - |

## 资源
- RESP 协议规范
- Node.js Net 模块文档
- Netty 框架文档

## 视觉/浏览器发现
<!-- 关键：每执行2次查看/浏览器操作后必须更新此部分 -->
<!-- 多模态内容必须立即以文本形式记录 -->
- N/A

---
*每执行2次查看/浏览器/搜索操作后更新此文件*
*防止视觉信息丢失*