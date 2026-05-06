package cn.linnin.linredis.command;

import cn.linnin.linredis.server.ClientState;
import cn.linnin.linredis.store.Database;
import java.util.*;
import java.util.regex.Pattern;

public class ServerCommands {
    public static void register(CommandRouter router) {
        router.register("PING", (c, args) -> args.isEmpty() ? "PONG" : args.get(0));

        router.register("SELECT", (c, args) -> {
            int idx = Integer.parseInt(args.get(0));
            c.selectDb(idx);
            return "OK";
        });

        router.register("FLUSHDB", (c, args) -> {
            c.getDb().flushDb();
            return "OK";
        });

        router.register("FLUSHALL", (c, args) -> {
            for (Database db : c.server.databases.values()) db.flushDb();
            return "OK";
        });

        router.register("SCAN", (c, args) -> {
            int cursor = Integer.parseInt(args.get(0));
            String match = "*";
            int count = 10;
            for (int i = 1; i < args.size(); i++) {
                String a = args.get(i).toUpperCase();
                if (a.equals("MATCH") && i + 1 < args.size()) match = args.get(++i);
                else if (a.equals("COUNT") && i + 1 < args.size()) count = Integer.parseInt(args.get(++i));
            }
            Database db = c.getDb();
            Set<String> allKeys = new LinkedHashSet<>();
            allKeys.addAll(db.strings.keySet());
            allKeys.addAll(db.hashes.keySet());
            allKeys.addAll(db.lists.keySet());
            allKeys.addAll(db.sets.keySet());
            allKeys.addAll(db.zsets.keySet());
            Pattern regex = patternToRegex(match);
            List<String> matching = new ArrayList<>();
            for (String k : allKeys) {
                if (regex.matcher(k).matches()) matching.add(k);
            }
            matching.sort(String::compareTo);
            int nextCursor = cursor + count >= matching.size() ? 0 : cursor + count;
            List<Object> result = new ArrayList<>();
            result.add(String.valueOf(nextCursor));
            result.add(matching.subList(cursor, Math.min(cursor + count, matching.size())));
            return result;
        });

        router.register("DBSIZE", (c, args) -> (long) c.getDb().dbSize());

        router.register("RANDOMKEY", (c, args) -> {
            Database db = c.getDb();
            List<String> all = new ArrayList<>();
            all.addAll(db.strings.keySet());
            all.addAll(db.hashes.keySet());
            all.addAll(db.lists.keySet());
            all.addAll(db.sets.keySet());
            all.addAll(db.zsets.keySet());
            return all.isEmpty() ? null : all.get(new Random().nextInt(all.size()));
        });

        router.register("INFO", (c, args) -> {
            String info = "# Server\nlin-redis:1.0.0\nredis_version:6.0.0\n";
            info += "# Keyspace\n";
            int totalKeys = 0;
            for (Database db : c.server.databases.values()) {
                totalKeys += db.dbSize();
            }
            info += "db0:keys=" + totalKeys + ",expires=0\n";
            return info;
        });

        router.register("COMMAND", (c, args) -> new ArrayList<>());

        router.register("QUIT", (c, args) -> "OK");
    }

    private static Pattern patternToRegex(String pattern) {
        StringBuilder sb = new StringBuilder("^");
        for (int i = 0; i < pattern.length(); i++) {
            char ch = pattern.charAt(i);
            switch (ch) {
                case '*': sb.append(".*"); break;
                case '?': sb.append('.'); break;
                default: sb.append(ch);
            }
        }
        sb.append('$');
        return Pattern.compile(sb.toString());
    }
}
