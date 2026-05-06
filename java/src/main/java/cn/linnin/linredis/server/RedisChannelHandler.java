package cn.linnin.linredis.server;

import cn.linnin.linredis.command.CommandRouter;
import cn.linnin.linredis.protocol.RespEncoder;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import java.util.List;

public class RedisChannelHandler extends ChannelInboundHandlerAdapter {

    private final RedisServer server;
    private ClientState client;

    public RedisChannelHandler(RedisServer server) {
        this.server = server;
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        client = new ClientState(server, ctx.channel());
        server.clients.add(client);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        if (client != null) server.clients.remove(client);
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        if (!(msg instanceof List)) return;
        @SuppressWarnings("unchecked")
        List<Object> cmdList = (List<Object>) msg;
        if (cmdList.isEmpty()) return;

        String commandName = String.valueOf(cmdList.get(0)).toUpperCase();
        List<String> args = new java.util.ArrayList<>();
        for (int i = 1; i < cmdList.size(); i++) {
            Object arg = cmdList.get(i);
            args.add(arg != null ? String.valueOf(arg) : null);
        }

        Object result = server.router.dispatch(client, commandName, args);
        ByteBuf buf = ctx.alloc().buffer();
        writeResponse(buf, result);
        ctx.writeAndFlush(buf);
    }

    private void writeResponse(ByteBuf buf, Object result) {
        if (result == null) {
            RespEncoder.writeNull(buf);
        } else if (result instanceof CommandRouter.ErrorResult) {
            RespEncoder.writeError(buf, ((CommandRouter.ErrorResult) result).message);
        } else if (result instanceof String) {
            String s = (String) result;
            if ("OK".equals(s) || "PONG".equals(s) || "none".equals(s)) {
                RespEncoder.writeSimpleString(buf, s);
            } else {
                RespEncoder.writeBulkString(buf, s);
            }
        } else if (result instanceof Long || result instanceof Integer) {
            RespEncoder.writeInteger(buf, (Number) result);
        } else if (result instanceof List) {
            RespEncoder.writeArray(buf, (List<?>) result);
        } else if (result instanceof byte[]) {
            buf.writeBytes((byte[]) result);
        } else {
            RespEncoder.writeBulkString(buf, String.valueOf(result));
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close();
    }
}
