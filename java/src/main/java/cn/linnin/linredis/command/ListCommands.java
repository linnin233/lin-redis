package cn.linnin.linredis.command;

import cn.linnin.linredis.server.ClientState;
import java.util.*;

public class ListCommands {
    public static void register(CommandRouter router) {
        router.register("LPUSH", (c, args) -> {
            return (long) c.getDb().lpush(args.get(0), args.subList(1, args.size()));
        });
        router.register("RPUSH", (c, args) -> {
            return (long) c.getDb().rpush(args.get(0), args.subList(1, args.size()));
        });
        router.register("LPOP", (c, args) -> {
            return c.getDb().lpop(args.get(0));
        });
        router.register("RPOP", (c, args) -> {
            return c.getDb().rpop(args.get(0));
        });
        router.register("LLEN", (c, args) -> {
            return (long) c.getDb().llen(args.get(0));
        });
        router.register("LRANGE", (c, args) -> {
            return c.getDb().lrange(args.get(0), Integer.parseInt(args.get(1)), Integer.parseInt(args.get(2)));
        });
    }

    private static Object err(String msg) { return new CommandRouter.ErrorResult(msg); }
}
