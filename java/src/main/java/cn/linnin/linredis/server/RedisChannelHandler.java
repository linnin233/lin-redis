package cn.linnin.linredis.server;

import cn.linnin.linredis.command.CommandRouter;
import cn.linnin.linredis.protocol.RespEncoder;
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import java.util.List;

/**
 * RedisChannelHandler - Redis 请求处理器
 * 
 * 基于 Netty 的 ChannelInboundHandlerAdapter 实现：
 * - 处理入站事件（数据读取、连接建立/断开）
 * - 责任链模式：在 RespDecoder 之后处理业务逻辑
 * - 每个 Channel 创建一个 ClientState 实例
 * 
 * 工作流程：
 * 1. channelActive()：连接建立时创建 ClientState
 * 2. channelRead()：接收解码后的 RESP 命令
 * 3. 路由命令到处理器，获取响应
 * 4. 编码响应为 RESP 格式
 * 5. channelInactive()：连接断开时清理 ClientState
 * 
 * 响应编码：
 * - 根据响应类型选择编码方法
 * - null -> writeNull()
 * - ErrorResult -> writeError()
 * - String -> writeBulkString() 或 writeSimpleString()
 * - Long/Integer -> writeInteger()
 * - List -> writeArray()
 */
public class RedisChannelHandler extends ChannelInboundHandlerAdapter {

    private final RedisServer server; // Redis 服务器实例
    private ClientState client; // 客户端状态

    /**
     * 创建请求处理器
     * 
     * @param server - RedisServer 实例
     */
    public RedisChannelHandler(RedisServer server) {
        this.server = server;
    }

    /**
     * 连接建立事件
     * 
     * @param ctx - ChannelHandlerContext
     * 
     * 创建 ClientState 并添加到服务器客户端集合
     */
    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        client = new ClientState(server, ctx.channel());
        server.clients.add(client); // 添加到客户端集合
    }

    /**
     * 连接断开事件
     * 
     * @param ctx - ChannelHandlerContext
     * 
     * 从服务器客户端集合移除 ClientState
     */
    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        if (client != null) server.clients.remove(client);
    }

    /**
     * 数据读取事件（核心处理逻辑）
     * 
     * @param ctx - ChannelHandlerContext
     * @param msg - 解码后的 RESP 命令（List<Object>）
     * 
     * 处理流程：
     * 1. 检查消息类型（必须是 List）
     * 2. 提取命令名和参数
     * 3. 路由命令到处理器
     * 4. 编码响应
     * 5. 发送响应
     */
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        if (!(msg instanceof List)) return; // 忽略非 List 消息
        
        @SuppressWarnings("unchecked")
        List<Object> cmdList = (List<Object>) msg;
        if (cmdList.isEmpty()) return;

        // 提取命令名和参数
        String commandName = String.valueOf(cmdList.get(0)).toUpperCase();
        List<String> args = new java.util.ArrayList<>();
        for (int i = 1; i < cmdList.size(); i++) {
            Object arg = cmdList.get(i);
            args.add(arg != null ? String.valueOf(arg) : null);
        }

        // 路由命令并获取响应
        Object result = server.router.dispatch(client, commandName, args);
        
        // 编码响应为 RESP 格式
        ByteBuf buf = ctx.alloc().buffer();
        writeResponse(buf, result);
        ctx.writeAndFlush(buf); // 发送响应
    }

    /**
     * 编码响应为 RESP 格式
     * 
     * @param buf - ByteBuf 输出缓冲区
     * @param result - 响应对象
     * 
     * 编码规则：
     * - null -> $-1\r\n
     * - ErrorResult -> -ERR message\r\n
     * - "OK"/"PONG"/"none" -> +OK\r\n（简单字符串）
     * - 其他 String -> Bulk String
     * - Long/Integer -> :integer\r\n
     * - List -> Array
     */
    private void writeResponse(ByteBuf buf, Object result) {
        if (result == null) {
            RespEncoder.writeNull(buf);
        } else if (result instanceof CommandRouter.ErrorResult) {
            RespEncoder.writeError(buf, ((CommandRouter.ErrorResult) result).message);
        } else if (result instanceof String) {
            String s = (String) result;
            // 简单字符串用于状态回复（OK、PONG、none）
            if ("OK".equals(s) || "PONG".equals(s) || "none".equals(s)) {
                RespEncoder.writeSimpleString(buf, s);
            } else {
                RespEncoder.writeBulkString(buf, s); // Bulk String
            }
        } else if (result instanceof Long || result instanceof Integer) {
            RespEncoder.writeInteger(buf, (Number) result);
        } else if (result instanceof List) {
            RespEncoder.writeArray(buf, (List<?>) result);
        } else if (result instanceof byte[]) {
            buf.writeBytes((byte[]) result); // 已编码数据
        } else {
            RespEncoder.writeBulkString(buf, String.valueOf(result));
        }
    }

    /**
     * 异常处理
     * 
     * @param ctx - ChannelHandlerContext
     * @param cause - 异常对象
     * 
     * 打印异常并关闭连接
     */
    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        cause.printStackTrace();
        ctx.close(); // 关闭连接
    }
}
