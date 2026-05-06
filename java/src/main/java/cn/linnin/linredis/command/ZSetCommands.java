package cn.linnin.linredis.command;

import cn.linnin.linredis.store.Database;
import java.util.*;

public class ZSetCommands {
    public static void register(CommandRouter router) {
        router.register("ZADD", (c, args) -> {
            List<Database.ZMember> members = new ArrayList<>();
            for (int i = 1; i < args.size(); i += 2) {
                members.add(new Database.ZMember(Double.parseDouble(args.get(i)), args.get(i + 1)));
            }
            return (long) c.getDb().zadd(args.get(0), members);
        });

        router.register("ZSCORE", (c, args) -> {
            Double score = c.getDb().zscore(args.get(0), args.get(1));
            return score != null ? String.valueOf(score) : null;
        });

        router.register("ZRANGE", (c, args) -> {
            boolean withScores = args.size() > 3 && args.get(3).equalsIgnoreCase("WITHSCORES");
            return c.getDb().zrange(args.get(0), Integer.parseInt(args.get(1)), Integer.parseInt(args.get(2)), withScores);
        });

        router.register("ZRANGEBYSCORE", (c, args) -> {
            double min = args.get(1).equals("-inf") ? Double.NEGATIVE_INFINITY : Double.parseDouble(args.get(1));
            double max = args.get(2).equals("+inf") ? Double.POSITIVE_INFINITY : Double.parseDouble(args.get(2));
            boolean withScores = false;
            int offset = 0, count = -1;
            for (int i = 3; i < args.size(); i++) {
                String a = args.get(i).toUpperCase();
                if (a.equals("WITHSCORES")) withScores = true;
                else if (a.equals("LIMIT") && i + 2 < args.size()) {
                    offset = Integer.parseInt(args.get(++i));
                    count = Integer.parseInt(args.get(++i));
                }
            }
            return c.getDb().zrangeByScore(args.get(0), min, max, withScores, offset, count);
        });

        router.register("ZREM", (c, args) -> {
            return (long) c.getDb().zrem(args.get(0), args.subList(1, args.size()));
        });

        router.register("ZCARD", (c, args) -> {
            var z = c.getDb().zsets.get(args.get(0));
            return (long) (z != null ? z.size() : 0);
        });

        router.register("ZCOUNT", (c, args) -> {
            double min = Double.parseDouble(args.get(1));
            double max = Double.parseDouble(args.get(2));
            var z = c.getDb().zsets.get(args.get(0));
            if (z == null) return 0L;
            long count = z.values().stream().filter(s -> s >= min && s <= max).count();
            return count;
        });
    }
}
