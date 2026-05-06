package cn.linnin.linredis.command;

import cn.linnin.linredis.server.ClientState;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

public class CommandRouter {
    private final ConcurrentHashMap<String, CommandHandler> commands = new ConcurrentHashMap<>();

    public void register(String name, CommandHandler handler) {
        commands.put(name.toUpperCase(), handler);
    }

    public Object dispatch(ClientState client, String commandName, List<String> args) {
        CommandHandler handler = commands.get(commandName.toUpperCase());
        if (handler == null) {
            return new ErrorResult("unknown command '" + commandName + "'");
        }
        try {
            return handler.execute(client, args);
        } catch (Exception e) {
            return new ErrorResult(e.getMessage());
        }
    }

    public int getCommandCount() {
        return commands.size();
    }

    public static class ErrorResult {
        public final String message;
        public ErrorResult(String message) { this.message = message; }
    }
}
