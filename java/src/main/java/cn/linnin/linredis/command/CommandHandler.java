package cn.linnin.linredis.command;

import cn.linnin.linredis.server.ClientState;
import java.util.List;

@FunctionalInterface
public interface CommandHandler {
    Object execute(ClientState client, List<String> args);
}
