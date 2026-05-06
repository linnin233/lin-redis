const CRLF = '\r\n';

function serializeSimpleString(str) {
  return `+${str}${CRLF}`;
}

function serializeError(msg) {
  return `-ERR ${msg}${CRLF}`;
}

function serializeInteger(n) {
  return `:${n}${CRLF}`;
}

function serializeBulkString(str) {
  if (str === null || str === undefined) return `$-1${CRLF}`;
  return `$${Buffer.byteLength(str, 'utf8')}${CRLF}${str}${CRLF}`;
}

function serializeNull() {
  return `$-1${CRLF}`;
}

function serializeArray(items) {
  if (items === null || items === undefined) return `*-1${CRLF}`;
  let result = `*${items.length}${CRLF}`;
  for (const item of items) {
    if (Array.isArray(item)) {
      result += serializeArray(item);
    } else if (typeof item === 'number') {
      result += serializeInteger(item);
    } else if (item === null || item === undefined) {
      result += serializeNull();
    } else {
      result += serializeBulkString(String(item));
    }
  }
  return result;
}

function serializeArrayRaw(items) {
  if (items === null || items === undefined) return `*-1${CRLF}`;
  return `*${items.length}${CRLF}${items.join('')}`;
}

class RespParser {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const results = [];
    while (true) {
      const result = this.tryParse();
      if (result === null) break;
      results.push(result);
    }
    return results;
  }

  tryParse() {
    if (this.buffer.length === 0) return null;
    const saved = this.buffer;
    try {
      const [parsed, consumed] = this._parseValue(0);
      if (parsed === undefined) {
        this.buffer = saved;
        return null;
      }
      this.buffer = this.buffer.slice(consumed);
      return parsed;
    } catch (e) {
      this.buffer = saved;
      return null;
    }
  }

  _parseValue(offset) {
    if (offset >= this.buffer.length) return [undefined, offset];
    const type = String.fromCharCode(this.buffer[offset]);
    switch (type) {
      case '+': return this._parseSimpleString(offset);
      case '-': return this._parseError(offset);
      case ':': return this._parseInteger(offset);
      case '$': return this._parseBulkString(offset);
      case '*': return this._parseArray(offset);
      default: return [undefined, offset];
    }
  }

  _parseSimpleString(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset];
    const str = this.buffer.toString('utf8', offset + 1, end);
    return [str, end + 2];
  }

  _parseError(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset];
    const msg = this.buffer.toString('utf8', offset + 1, end);
    return [new Error(msg), end + 2];
  }

  _parseInteger(offset) {
    const end = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (end === -1) return [undefined, offset];
    const n = parseInt(this.buffer.toString('utf8', offset + 1, end), 10);
    return [n, end + 2];
  }

  _parseBulkString(offset) {
    const endLen = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (endLen === -1) return [undefined, offset];
    const len = parseInt(this.buffer.toString('utf8', offset + 1, endLen), 10);
    if (len === -1) return [null, endLen + 2];
    const dataStart = endLen + 2;
    const dataEnd = dataStart + len;
    if (this.buffer.length < dataEnd + 2) return [undefined, offset];
    const str = this.buffer.toString('utf8', dataStart, dataEnd);
    return [str, dataEnd + 2];
  }

  _parseArray(offset) {
    const endCount = this.buffer.indexOf('\r\n', offset, 'utf8');
    if (endCount === -1) return [undefined, offset];
    const count = parseInt(this.buffer.toString('utf8', offset + 1, endCount), 10);
    if (count === -1) return [null, endCount + 2];
    let pos = endCount + 2;
    const items = [];
    for (let i = 0; i < count; i++) {
      const [val, newPos] = this._parseValue(pos);
      if (val === undefined) return [undefined, offset];
      items.push(val);
      pos = newPos;
    }
    return [items, pos];
  }

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
