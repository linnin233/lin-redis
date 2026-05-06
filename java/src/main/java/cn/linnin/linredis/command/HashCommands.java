package cn.linnin.linredis.command;

import cn.linnin.linredis.store.Database;
import cn.linnin.linredis.server.ClientState;
import java.util.*;

public class HashCommands {
    public static void register(CommandRouter router) {
        router.register("HSET", (c, args) -> {
            if (args.size() < 3 || args.size() % 2 != 1) return err("wrong number of arguments");
            Database db = c.getDb();
            int count = 0;
            for (int i = 1; i < args.size(); i += 2) {
                if (db.hget(args.get(0), args.get(i)) == null) count++;
                db.hset(args.get(0), args.get(i), args.get(i + 1));
            }
            return (long) count;
        });

        router.register("HMSET", (c, args) -> {
            if (args.size() < 3 || args.size() % 2 != 1) return err("wrong number of arguments");
            for (int i = 1; i < args.size(); i += 2)
                c.getDb().hset(args.get(0), args.get(i), args.get(i + 1));
            return "OK";
        });

        router.register("HGET", (c, args) -> {
            return c.getDb().hget(args.get(0), args.get(1));
        });

        router.register("HGETALL", (c, args) -> {
            Map<String, String> map = c.getDb().hgetall(args.get(0));
            List<String> result = new ArrayList<>();
            for (Map.Entry<String, String> e : map.entrySet()) {
                result.add(e.getKey());
                result.add(e.getValue());
            }
            return result;
        });

        router.register("HDEL", (c, args) -> {
            long count = 0;
            for (int i = 1; i < args.size(); i++)
                count += c.getDb().hdel(args.get(0), args.get(i));
            return count;
        });

        router.register("HMGET", (c, args) -> {
            return c.getDb().hmget(args.get(0), args.subList(1, args.size()));
        });

        router.register("HEXISTS", (c, args) -> {
            return (long) c.getDb().hexists(args.get(0), args.get(1));
        });

        router.register("HLEN", (c, args) -> {
            return (long) c.getDb().hlen(args.get(0));
        });

        router.register("HKEYS", (c, args) -> {
            return new ArrayList<>(c.getDb().hgetall(args.get(0)).keySet());
        });

        router.register("HVALS", (c, args) -> {
            return new ArrayList<>(c.getDb().hgetall(args.get(0)).values());
        });

        router.register("HSETNX", (c, args) -> {
            return (long) c.getDb().hsetnx(args.get(0), args.get(1), args.get(2));
        });
    }

    private static Object err(String msg) { return new CommandRouter.ErrorResult(msg); }
}
