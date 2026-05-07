/**
 * ExpiryManager 过期键管理器
 * 
 * 负责定期扫描并清理过期的键，解决惰性过期策略的问题：
 * - 惰性过期：访问时才检查过期，可能导致过期键长期占用内存
 * - 定期清理：定期扫描并主动删除过期键
 * 
 * 工作原理：
 * - 使用定时器定期扫描（默认每100ms）
 * - 遍历所有数据库的所有数据类型
 * - 检查每个 entry 的 _expiry 字段
 * - 删除已过期的键，并统计清理数量
 * 
 * 性能考虑：
 * - 扫描频率不宜太高，避免影响性能
 * - 生产环境可以使用更高效的过期策略
 *   - 如 Redis 的定期扫描+惰性过期混合策略
 */
class ExpiryManager {
  /**
   * 创建过期管理器
   * 
   * @param databases - 数据库集合（Map<index, Database>）
   * @param sweepIntervalMs - 扫描间隔（毫秒），默认100ms
   */
  constructor(databases, sweepIntervalMs = 100) {
    this.databases = databases;
    this.sweepIntervalMs = sweepIntervalMs;
    this.timer = null; // 定时器引用
    this.stats = { expired: 0, sweeps: 0 }; // 统计信息
  }

  /**
   * 启动定时清理任务
   * 
   * 使用 setInterval 定期执行 sweep() 方法
   */
  start() {
    this.timer = setInterval(() => this.sweep(), this.sweepIntervalMs);
  }

  /**
   * 停止定时清理任务
   * 
   * 清理定时器，停止扫描
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行一次过期键清理
   * 
   * 扫描流程：
   * 1. 遍历所有数据库
   * 2. 对每个数据库的每种数据类型（strings, hashes, lists, sets, zsets）
   * 3. 检查每个键是否过期
   * 4. 删除过期键并更新统计
   * 
   * 性能优化：
   * - 只检查有 _expiry 字段的 entry
   * - 删除操作直接调用 Map.delete()
   */
  sweep() {
    this.stats.sweeps++; // 记录扫描次数
    for (const db of this.databases.values()) {
      // 遍历所有数据类型
      for (const storeType of ['strings', 'hashes', 'lists', 'sets', 'zsets']) {
        const store = db[storeType];
        if (!store) continue;
        
        // 遍历该类型的所有键
        for (const [key, entry] of store) {
          if (this._isExpired(entry)) {
            store.delete(key); // 删除过期键
            this.stats.expired++; // 统计过期数量
          }
        }
      }
    }
  }

  /**
   * 检查 entry 是否已过期
   * 
   * @param entry - entry 对象
   * @returns 是否过期
   * 
   * 过期判断：
   * - 没有 _expiry 字段：永不过期
   * - 当前时间 >= _expiry：已过期
   */
  _isExpired(entry) {
    if (!entry || !entry._expiry) return false; // 无过期时间
    return Date.now() >= entry._expiry; // 检查是否过期
  }

  /**
   * 检查单个键是否过期（用于惰性过期）
   * 
   * @param key - 键名
   * @param db - 数据库实例
   * @returns 是否过期
   * 
   * 工作流程：
   * - 查找该键在哪个数据类型中
   * - 检查过期状态
   * - 如果过期，删除并返回 true
   */
  isKeyExpired(key, db) {
    for (const storeType of ['strings', 'hashes', 'lists', 'sets', 'zsets']) {
      const store = db[storeType];
      if (store.has(key)) {
        const entry = store.get(key);
        if (this._isExpired(entry)) {
          store.delete(key); // 惰性删除
          this.stats.expired++;
          return true;
        }
        return false; // 未过期
      }
    }
    return false; // 键不存在
  }

  /**
   * 获取过期统计信息
   * 
   * @returns {expired, sweeps} - 过期数量和扫描次数
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = { ExpiryManager };
