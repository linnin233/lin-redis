package cn.linnin.linredis.server;

import cn.linnin.linredis.command.*;
import cn.linnin.linredis.protocol.RespDecoder;
import cn.linnin.linredis.store.Database;
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.channel.socket.SocketChannel;
import java.util.*;
import java.util.concurrent.*;

/**
 * RedisServer - Redis 服务器实现（Java 版）
 * 
 * 基于 Netty 框架实现的高性能 Redis 服务器：
 * - Reactor 模型：Boss Group + Worker Group 处理并发连接
 * - ChannelPipeline：责任链模式处理请求（Decoder -> Handler）
 * - 异步 IO：非阻塞 IO，提高并发性能
 * 
 * 核心组件：
 * - ServerBootstrap：服务器启动配置
 * - NioEventLoopGroup：事件循环组（Boss + Worker）
 * - RespDecoder：RESP 协议解码器
 * - RedisChannelHandler：请求处理器
 * - CommandRouter：命令路由器
 * - Database：数据存储
 * - ScheduledExecutorService：过期键清理
 * 
 * 架构设计：
 * - Boss Group：接收新连接
 * - Worker Group：处理连接的 IO 事件
 * - ChannelHandler：处理业务逻辑
 * - 线程安全：使用 ConcurrentHashMap
 * 
 * 启动流程：
 * 1. 创建 EventLoopGroup（Boss + Worker）
 * 2. 配置 ServerBootstrap
 * 3. 添加 ChannelHandler 到 Pipeline
 * 4. 绑定端口并监听
 * 5. 启动过期清理定时任务
 */
public class RedisServer {

    public final int port; // 监听端口
    public final String host; // 监听地址
    public final boolean requirePass; // 是否要求认证
    public final String password; // 认证密码
    public final ConcurrentHashMap<Integer, Database> databases = new ConcurrentHashMap<>(); // 数据库集合
    public final CommandRouter router = new CommandRouter(); // 命令路由器
    public final Set<ClientState> clients = ConcurrentHashMap.newKeySet(); // 客户端集合

    private EventLoopGroup bossGroup; // Boss 线程组（接收连接）
    private EventLoopGroup workerGroup; // Worker 线程组（处理 IO）
    private Channel serverChannel; // 服务器通道
    private ScheduledExecutorService expiryExecutor; // 过期清理定时器

    /**
     * 创建 Redis 服务器实例
     * 
     * @param port - 监听端口（默认 6379）
     * @param host - 监听地址（默认 127.0.0.1）
     * @param password - 认证密码（可选）
     * 
     * 初始化流程：
     * 1. 创建默认数据库（Database 0）
     * 2. 注册所有命令处理器
     */
    public RedisServer(int port, String host, String password) {
        this.port = port;
        this.host = host;
        this.password = password;
        this.requirePass = password != null && !password.isEmpty();
        databases.put(0, new Database(0)); // 创建默认数据库

        // 注册所有命令处理器
        StringCommands.register(router);
        HashCommands.register(router);
        ListCommands.register(router);
        SetCommands.register(router);
        ZSetCommands.register(router);
        ServerCommands.register(router);
    }

    /**
     * 获取或创建数据库实例
     * 
     * @param index - 数据库索引
     * @return Database 实例
     * 
     * 线程安全：使用 computeIfAbsent 保证原子性
     */
    public Database getDatabase(int index) {
        return databases.computeIfAbsent(index, Database::new);
    }

    /**
     * 启动服务器
     * 
     * @throws InterruptedException - 启动异常
     * 
     * 启动流程：
     * 1. 创建 Boss Group（1个线程）和 Worker Group（多线程）
     * 2. 配置 ServerBootstrap：
     *    - 使用 NioServerSocketChannel（非阻塞 IO）
     *    - 添加 ChannelInitializer 配置 Pipeline
     *    - 设置 SO_BACKLOG（连接队列长度）
     *    - 设置 SO_KEEPALIVE（保持连接）
     * 3. 绑定端口并同步等待
     * 4. 启动过期键清理定时任务（每100ms）
     */
    public void start() throws InterruptedException {
        bossGroup = new NioEventLoopGroup(1); // Boss 线程：接收连接
        workerGroup = new NioEventLoopGroup(); // Worker 线程：处理 IO

        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class) // 使用 NIO 通道
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) {
                        // 配置 Channel Pipeline（责任链）
                        ch.pipeline()
                                .addLast(new RespDecoder()) // 添加 RESP 解码器
                                .addLast(new RedisChannelHandler(RedisServer.this)); // 添加请求处理器
                    }
                })
                .option(ChannelOption.SO_BACKLOG, 128) // 连接队列长度
                .childOption(ChannelOption.SO_KEEPALIVE, true); // 保持连接

        // 绑定端口并启动服务器
        serverChannel = bootstrap.bind(host, port).sync().channel();

        // 启动过期键清理定时任务
        expiryExecutor = Executors.newSingleThreadScheduledExecutor();
        expiryExecutor.scheduleAtFixedRate(this::sweepExpired, 100, 100, TimeUnit.MILLISECONDS);
    }

    /**
     * 停止服务器
     * 
     * 关闭流程：
     * 1. 停止过期清理定时器
     * 2. 关闭所有客户端连接
     * 3. 关闭服务器通道
     * 4. 关闭 EventLoopGroup
     */
    public void stop() {
        if (expiryExecutor != null) expiryExecutor.shutdown(); // 停止定时器
        
        // 关闭所有客户端连接
        for (ClientState client : clients) {
            try { client.channel.close(); } catch (Exception ignored) {}
        }
        clients.clear();
        
        if (serverChannel != null) serverChannel.close(); // 关闭服务器通道
        if (bossGroup != null) bossGroup.shutdownGracefully(); // 关闭 Boss Group
        if (workerGroup != null) workerGroup.shutdownGracefully(); // 关闭 Worker Group
    }

    /**
     * 定期清理过期键
     * 
     * 扫描所有数据库的 strings 类型，删除过期键
     * 
     * 注意：只清理 strings 类型，其他类型的过期清理需要扩展
     */
    private void sweepExpired() {
        for (Database db : databases.values()) {
            Iterator<Map.Entry<String, Database.StringEntry>> it = db.strings.entrySet().iterator();
            while (it.hasNext()) {
                if (it.next().getValue().isExpired()) it.remove(); // 删除过期键
            }
        }
    }

    /**
     * 获取已注册命令数量
     * 
     * @return 命令数量
     */
    public int getCommandCount() { return router.getCommandCount(); }
}
