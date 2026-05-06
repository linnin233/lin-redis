package cn.linnin.linredis.command;

import java.util.*;

public class SetCommands {
    public static void register(CommandRouter router) {
        router.register("SADD", (c, args) -> {
            return (long) c.getDb().sadd(args.get(0), args.subList(1, args.size()));
        });
        router.register("SREM", (c, args) -> {
            return (long) c.getDb().srem(args.get(0), args.subList(1, args.size()));
        });
        router.register("SISMEMBER", (c, args) -> {
            return (long) c.getDb().sismember(args.get(0), args.get(1));
        });
        router.register("SMEMBERS", (c, args) -> {
            return new ArrayList<>(c.getDb().smembers(args.get(0)));
        });
        router.register("SCARD", (c, args) -> {
            return (long) c.getDb().smembers(args.get(0)).size();
        });
    }
}
