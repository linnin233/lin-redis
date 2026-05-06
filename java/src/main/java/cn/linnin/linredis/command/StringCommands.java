package cn.linnin.linredis.command;

import cn.linnin.linredis.server.ClientState;
import cn.linnin.linredis.store.Database;
import java.util.*;

public class StringCommands {

    public static void register(CommandRouter router) {
        router.register("SET", (c, args) -> {
            if (args.size() < 2) return err("wrong number of arguments for SET");
            String key = args.get(0);
            String value = args.get(1);
            long ttlMs = 0;
            boolean nx = false, xx = false;
            for (int i = 2; i < args.size(); i++) {
                String a = args.get(i).toUpperCase();
                switch (a) {
                    case "EX": ttlMs = Long.parseLong(args.get(++i)) * 1000; break;
                    case "PX": ttlMs = Long.parseLong(args.get(++i)); break;
                    case "NX": nx = true; break;
                    case "XX": xx = true; break;
                }
            }
            Database db = c.getDb();
            if (nx && db.existsKey(key)) return null;
            if (xx && !db.existsKey(key)) return null;
            db.setString(key, value, ttlMs);
            return "OK";
        });

        router.register("GET", (c, args) -> {
            if (args.size() != 1) return err("wrong number of arguments for GET");
            return c.getDb().getString(args.get(0));
        });

        router.register("SETEX", (c, args) -> {
            if (args.size() != 3) return err("wrong number of arguments for SETEX");
            c.getDb().setString(args.get(0), args.get(2), Long.parseLong(args.get(1)) * 1000);
            return "OK";
        });

        router.register("DEL", (c, args) -> {
            if (args.isEmpty()) return err("wrong number of arguments for DEL");
            return (long) c.getDb().deleteKeys(args);
        });

        router.register("EXISTS", (c, args) -> {
            int count = 0;
            Database db = c.getDb();
            for (String key : args) if (db.existsKey(key)) count++;
            return (long) count;
        });

        router.register("EXPIRE", (c, args) -> {
            if (args.size() < 2) return err("wrong number of arguments for EXPIRE");
            return (long) c.getDb().expireKey(args.get(0), Long.parseLong(args.get(1)) * 1000);
        });

        router.register("TTL", (c, args) -> {
            Database.StringEntry e = c.getDb().strings.get(args.get(0));
            if (e == null) return -2L;
            if (e.expiry == 0) return -1L;
            long ttl = (e.expiry - System.currentTimeMillis()) / 1000;
            return ttl >= 0 ? ttl : -2L;
        });

        router.register("INCR", (c, args) -> {
            return (long) c.getDb().incrby(args.get(0), 1);
        });

        router.register("INCRBY", (c, args) -> {
            return (long) c.getDb().incrby(args.get(0), Long.parseLong(args.get(1)));
        });

        router.register("DECR", (c, args) -> {
            return (long) c.getDb().incrby(args.get(0), -1);
        });

        router.register("DECRBY", (c, args) -> {
            return (long) c.getDb().incrby(args.get(0), -Long.parseLong(args.get(1)));
        });

        router.register("MGET", (c, args) -> {
            Database db = c.getDb();
            List<Object> result = new ArrayList<>();
            for (String key : args) result.add(db.getString(key));
            return result;
        });

        router.register("MSET", (c, args) -> {
            if (args.size() < 2 || args.size() % 2 != 0) return err("wrong number of arguments for MSET");
            Database db = c.getDb();
            for (int i = 0; i < args.size(); i += 2) db.setString(args.get(i), args.get(i + 1), 0);
            return "OK";
        });

        router.register("KEYS", (c, args) -> {
            return c.getDb().keysByPattern(args.get(0));
        });
    }

    private static Object err(String msg) {
        return new CommandRouter.ErrorResult(msg);
    }
}
