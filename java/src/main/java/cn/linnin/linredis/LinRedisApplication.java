package cn.linnin.linredis;

import cn.linnin.linredis.server.RedisServer;

public class LinRedisApplication {
    public static void main(String[] args) throws Exception {
        int port = Integer.parseInt(System.getenv().getOrDefault("LIN_REDIS_PORT", "6389"));
        String host = System.getenv().getOrDefault("LIN_REDIS_HOST", "127.0.0.1");
        String password = System.getenv().getOrDefault("LIN_REDIS_PASSWORD", "");

        RedisServer server = new RedisServer(port, host, password);
        server.start();
        System.out.println("lin-redis (Java) listening on " + host + ":" + port);
        System.out.println("  Commands registered: " + server.getCommandCount());
        if (!password.isEmpty()) System.out.println("  Auth: enabled");

        Runtime.getRuntime().addShutdownHook(new Thread(server::stop));
    }
}
