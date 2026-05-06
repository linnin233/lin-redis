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

public class RedisServer {

    public final int port;
    public final String host;
    public final boolean requirePass;
    public final String password;
    public final ConcurrentHashMap<Integer, Database> databases = new ConcurrentHashMap<>();
    public final CommandRouter router = new CommandRouter();
    public final Set<ClientState> clients = ConcurrentHashMap.newKeySet();

    private EventLoopGroup bossGroup;
    private EventLoopGroup workerGroup;
    private Channel serverChannel;
    private ScheduledExecutorService expiryExecutor;

    public RedisServer(int port, String host, String password) {
        this.port = port;
        this.host = host;
        this.password = password;
        this.requirePass = password != null && !password.isEmpty();
        databases.put(0, new Database(0));

        StringCommands.register(router);
        HashCommands.register(router);
        ListCommands.register(router);
        SetCommands.register(router);
        ZSetCommands.register(router);
        ServerCommands.register(router);
    }

    public Database getDatabase(int index) {
        return databases.computeIfAbsent(index, Database::new);
    }

    public void start() throws InterruptedException {
        bossGroup = new NioEventLoopGroup(1);
        workerGroup = new NioEventLoopGroup();

        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<SocketChannel>() {
                    @Override
                    protected void initChannel(SocketChannel ch) {
                        ch.pipeline()
                                .addLast(new RespDecoder())
                                .addLast(new RedisChannelHandler(RedisServer.this));
                    }
                })
                .option(ChannelOption.SO_BACKLOG, 128)
                .childOption(ChannelOption.SO_KEEPALIVE, true);

        serverChannel = bootstrap.bind(host, port).sync().channel();

        expiryExecutor = Executors.newSingleThreadScheduledExecutor();
        expiryExecutor.scheduleAtFixedRate(this::sweepExpired, 100, 100, TimeUnit.MILLISECONDS);
    }

    public void stop() {
        if (expiryExecutor != null) expiryExecutor.shutdown();
        for (ClientState client : clients) {
            try { client.channel.close(); } catch (Exception ignored) {}
        }
        clients.clear();
        if (serverChannel != null) serverChannel.close();
        if (bossGroup != null) bossGroup.shutdownGracefully();
        if (workerGroup != null) workerGroup.shutdownGracefully();
    }

    private void sweepExpired() {
        for (Database db : databases.values()) {
            Iterator<Map.Entry<String, Database.StringEntry>> it = db.strings.entrySet().iterator();
            while (it.hasNext()) {
                if (it.next().getValue().isExpired()) it.remove();
            }
        }
    }

    public int getCommandCount() { return router.getCommandCount(); }
}
