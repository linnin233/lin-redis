/**
 * RESP（REdis Serialization Protocol）协议实现
 * 
 * RESP 是 Redis 的通信协议，支持以下5种数据类型：
 * 1. 简单字符串（Simple String）：+OK\r\n
 * 2. 错误（Error）：-ERR message\r\n
 * 3. 整数（Integer）：:100\r\n
 * 4. 批量字符串（Bulk String）：$6\r\nfoobar\r\n
 * 5. 数组（Array）：*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n
 * 
 * 所有 RESP 数据都以 \r\n（CRLF）作为分隔符
 */
const CRLF = '\r\n'; // RESP 协议的分隔符（换行符）

/**
 * 序列化简单字符串
 * 格式：+<string>\r\n
 * 用于简单的状态回复，如 OK、PONG
 */
function serializeSimpleString(str) {
  return `+${str}${CRLF}`;
}

/**
 * 序列化错误消息
 * 格式：-ERR <message>\r\n
 * 用于返回错误信息给客户端
 */
function serializeError(msg) {
  return `-ERR ${msg}${CRLF}`;
}

/**
 * 序列化整数
 * 格式：:<integer>\r\n
 * 用于返回数值，如命令执行结果计数
 */
function serializeInteger(n) {
  return `:${n}${CRLF}`;
}

/**
 * 序列化批量字符串
 * 格式：$<length>\r\n<data>\r\n
 * 用于返回字符串数据，$-1 表示 null（键不存在）
 * 注意：使用 Buffer.byteLength 计算字节长度，支持 UTF-8 编码
 */
function serializeBulkString(str) {
  if (str === null || str === undefined) return `$-1${CRLF}`;
  return `$${Buffer.byteLength(str, 'utf8')}${CRLF}${str}${CRLF}`;
}

/**
 * 序列化空值（null）
 * 返回 $-1\r\n，表示键不存在或值为 null
 */
function serializeNull() {
  return `$-1${CRLF}`;
}

/**
 * 序列化数组
 * 格式：*<count>\r\n<item1><item2>...
 * 数组可以包含任意类型的元素，递归序列化
 * 用于返回多个值，如 MGET 结果、KEYS 列表
 * 
 * @param items - 数组元素，可以是字符串、数字、null、嵌套数组
 * @returns RESP 格式的数组字符串
 */
function serializeArray(items) {
  if (items === null || items === undefined) return `*-1${CRLF}`;
  let result = `*${items.length}${CRLF}`;
  for (const item of items) {
    if (Array.isArray(item)) {
      result += serializeArray(item); // 递归处理嵌套数组
    } else if (typeof item === 'number') {
      result += serializeInteger(item); // 整数类型
    } else if (item === null || item === undefined) {
      result += serializeNull(); // null 值
    } else {
      result += serializeBulkString(String(item)); // 字符串类型
    }
  }
  return result;
}

/**
 * 序列化原始数组（元素已经是 RESP 格式）
 * 用于性能优化，当元素已经是序列化格式时直接拼接
 * 
 * @param items - 已序列化的 RESP 数据数组
 */
function serializeArrayRaw(items) {
  if (items === null || items === undefined) return `*-1${CRLF}`;
  return `*${items.length}${CRLF}${items.join('')}`;
}

/**
 * RESP 协议解析器
 * 
 * 采用流式解析（Streaming Parser）设计：
 * - 支持增量接收数据（TCP 粘包/拆包场景）
 * - 数据可能分多次到达，解析器会缓存不完整的数据
 * - 每次接收到数据后尝试解析完整的 RESP 值
 * 
 * 工作原理：
 * 1. feed(data) 接收数据并追加到 buffer
 * 2. tryParse() 尝试从 buffer 解析完整的 RESP 值
 * 3. 解析成功后，从 buffer 中移除已解析的数据
 * 4. 解析失败（数据不完整）时，保留 buffer 等待更多数据
 * 
 * 示例：
 * 客户端发送：SET key value
 * RESP 格式：*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n
 * 可能分多次到达，解析器会自动处理
 */
class RespParser {
  constructor() {
    this.buffer = Buffer.alloc(0); // 数据缓冲区，存储未解析的原始字节
  }

  /**
   * 接收并解析数据
   * 
   * @param data - 接收到的 Buffer 数据
   * @returns 解析出的命令数组，可能包含多个完整命令
   * 
   * 流程：
   * 1. 将新数据追加到 buffer
   * 2. 循环尝试解析，直到 buffer 中没有完整命令
   * 3. 返回所有解析出的命令
   */
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const results = [];
    while (true) {
      const result = this.tryParse();
      if (result === null) break; // 数据不完整，等待更多数据
      results.push(result);
    }
    return results;
  }

  /**
   * 尝试从 buffer 解析一个完整的 RESP 值
   * 
   * @returns 解析结果，如果数据不完整返回 null
   * 
   * 解析失败时会恢复 buffer 状态（保存点机制）：
   * - 记录初始 buffer 位置（saved）
   * - 尝试解析，如果失败恢复到 saved
   * - 这样确保部分数据不会丢失
   */
  tryParse() {
    if (this.buffer.length === 0) return null;
    const saved = this.buffer; // 保存当前 buffer 状态
    try {
      const [parsed, consumed] = this._parseValue(0);
      if (parsed === undefined) {
        this.buffer = saved; // 解析失败，恢复 buffer
        return null;
      }
      this.buffer = this.buffer.slice(consumed); // 移除已解析的数据
      return parsed;
    } catch (e) {
      this.buffer = saved; // 异常时恢复 buffer
      return null;
    }
  }

  /**
   * 解析 RESP 值（核心解析逻辑）
   * 
   * @param offset - buffer 中的起始位置
   * @returns [解析值, 消耗的字节数]
   * 
   * 根据第一个字节判断数据类型：
   * - '+' 简单字符串
   * - '-' 错误
   * - ':' 整数
   * - '$' 批量字符串
   * - '*' 数组
   */
  _parseValue(offset) {
    if (offset >= this.buffer.length) return [undefined, offset];
    const type = String.fromCharCode(this.buffer[offset]);
    switch (type) {
      case '+': return this._parseSimpleString(offset);
      case '-': return this._parseError(offset);
      case ':': return this._parseInteger(offset);
      case '$': return this._parseBulkString(offset);
      case '*': return this._parseArray(offset);
      default: return [undefined, offset]; // 未知的类型标识符
    }
  }

  /**
   * 解析简单字符串
   * 格式：+<string>\r\n
   * 
   * @param offset - 起始位置
   * @returns [字符串值, 结束位置]
   */
  _parseSimpleString(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset]; // 未找到分隔符，数据不完整
    const str = this.buffer.toString('utf8', offset + 1, end); // 提取字符串（跳过 '+'）
    return [str, end + 2]; // end + 2 是 \r\n 的长度
  }

  /**
   * 解析错误消息
   * 格式：-<error message>\r\n
   * 
   * @param offset - 起始位置
   * @returns [Error 对象, 结束位置]
   */
  _parseError(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset];
    const msg = this.buffer.toString('utf8', offset + 1, end);
    return [new Error(msg), end + 2]; // 返回 Error 对象，便于异常处理
  }

  /**
   * 解析整数
   * 格式：:<integer>\r\n
   * 
   * @param offset - 起始位置
   * @returns [整数值, 结束位置]
   */
  _parseInteger(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset];
    const n = parseInt(this.buffer.toString('utf8', offset + 1, end), 10);
    return [n, end + 2];
  }

  /**
   * 解析批量字符串
   * 格式：$<length>\r\n<data>\r\n
   * 
   * 特殊情况：
   * - $-1\r\n 表示 null（键不存在）
   * - $0\r\n\r\n 表示空字符串
   * 
   * @param offset - 装始位置
   * @returns [字符串值或 null, 结束位置]
   */
  _parseBulkString(offset) {
    const endLen = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (endLen === -1) return [undefined, offset]; // 长度字段不完整
    
    const len = parseInt(this.buffer.toString('utf8', offset + 1, endLen), 10);
    if (len === -1) return [null, endLen + 2]; // null 值
    
    const dataStart = endLen + 2; // 数据起始位置（跳过长度字段和 \r\n）
    const dataEnd = dataStart + len; // 数据结束位置
    
    // 检查数据是否完整（包含最后的 \r\n）
    if (this.buffer.length < dataEnd + 2) return [undefined, offset];
    
    const str = this.buffer.toString('utf8', dataStart, dataEnd);
    return [str, dataEnd + 2]; // 包含数据后的 \r\n
  }

  /**
   * 解析数组
   * 格式：*<count>\r\n<item1><item2>...
   * 
   * 数组可以包含任意类型的元素，递归解析
   * 
   * 特殊情况：
   * - *-1\r\n 表示 null 数组
   * - *0\r\n 表示空数组
   * 
   * @param offset - 装始位置
   * @returns [元素数组或 null, 结束位置]
   */
  _parseArray(offset) {
    const endCount = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (endCount === -1) return [undefined, offset]; // 计数字段不完整
    
    const count = parseInt(this.buffer.toString('utf8', offset + 1, endCount), 10);
    if (count === -1) return [null, endCount + 2]; // null 数组
    
    let pos = endCount + 2; // 从第一个元素开始解析
    const items = [];
    
    // 逐个解析元素，如果任一元素不完整，整体解析失败
    for (let i = 0; i < count; i++) {
      const [val, newPos] = this._parseValue(pos);
      if (val === undefined) return [undefined, offset]; // 元素不完整
      items.push(val);
      pos = newPos;
    }
    
    return [items, pos];
  }

  /**
   * 重置解析器状态
   * 清空 buffer，用于异常恢复或重新初始化
   */
  reset() {
    this.buffer = Buffer.alloc(0);
  }
}

module.exports = {
  serializeSimpleString,
  serializeError,
  serializeInteger,
  serializeBulkString,
  serializeNull,
  serializeArray,
  serializeArrayRaw,
  RespParser,
  CRLF
};
