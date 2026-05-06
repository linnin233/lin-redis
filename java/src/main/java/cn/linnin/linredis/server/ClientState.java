package cn.linnin.linredis.server;

import cn.linnin.linredis.store.Database;
import io.netty.channel.Channel;

public class ClientState {
    public final Channel channel;
    public final RedisServer server;
    private int dbIndex = 0;
    public boolean authenticated;

    public ClientState(RedisServer server, Channel channel) {
        this.server = server;
        this.channel = channel;
        this.authenticated = !server.requirePass;
    }

    public Database getDb() {
        return server.getDatabase(dbIndex);
    }

    public void selectDb(int index) {
        server.databases.computeIfAbsent(index, Database::new);
        this.dbIndex = index;
    }

    public int getDbIndex() { return dbIndex; }
}
