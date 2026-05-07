package cn.linnin.linredis.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * RESP 协议解码器（Decoder）
 * 
 * 基于 Netty 的 ByteToMessageDecoder 实现，自动处理 TCP 粘包/拆包：
 * - ByteToMessageDecoder 是 Netty 提供的解码器基类
 * - 自动管理缓冲区，数据不足时等待更多数据
 * - 解码成功后自动将消息传递给下一个 Handler
 * 
 * RESP 协议支持5种数据类型：
 * 1. 简单字符串（Simple String）：+OK\r\n
 * 2. 错误（Error）：-ERR message\r\n
 * 3. 整数（Integer）：:100\r\n
 * 4. 批量字符串（Bulk String）：$6\r\nfoobar\r\n
 * 5. 数组（Array）：*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n
 * 
 * 解码流程：
 * 1. decode() 方法被 Netty 自动调用（有数据到达时）
 * 2. 记录 readerIndex（读取位置），用于恢复
 * 3. 调用 parseValue() 解析 RESP 值
 * 4. 解析失败时恢复 readerIndex，等待更多数据
 * 5. 解析成功时添加到 out 列表，传递给下一个 Handler
 * 
 * 性能优化：
 * - 使用 ByteBuf 直接操作字节，零拷贝
 * - 不完整的消息会被缓存，下次继续解析
 */
public class RespDecoder extends ByteToMessageDecoder {

    /**
     * 解码方法：Netty 自动调用
     * 
     * @param ctx - ChannelHandlerContext，通道上下文
     * @param in - ByteBuf，输入缓冲区（接收到的数据）
     * @param out - List<Object>，输出列表（解码后的消息）
     * 
     * 工作原理：
     * - ByteToMessageDecoder 会自动管理缓冲区
     * - 如果数据不足以解码完整消息，保留数据等待下次
     * - 解码成功后，消息会传递给下一个 ChannelHandler
     */
    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        if (in.readableBytes() == 0) return; // 无数据
        
        int readerIndex = in.readerIndex(); // 记录当前读取位置
        Object result = parseValue(in); // 尝试解析
        
        if (result == null) {
            // 解析失败（数据不完整），恢复读取位置，等待更多数据
            in.readerIndex(readerIndex);
            return;
        }
        
        // 解析成功，添加到输出列表
        out.add(result);
    }

    /**
     * 解析 RESP 值（核心解析逻辑）
     * 
     * @param in - ByteBuf，输入缓冲区
     * @return 解析结果（String, Long, List, RuntimeException, null）
     * 
     * 根据第一个字节判断数据类型：
     * - '+' -> parseSimpleString()：简单字符串
     * - '-' -> parseError()：错误消息
     * - ':' -> parseInteger()：整数
     * - '$' -> parseBulkString()：批量字符串
     * - '*' -> parseArray()：数组
     */
    private Object parseValue(ByteBuf in) {
        if (in.readableBytes() == 0) return null;
        int idx = in.readerIndex();
        byte type = in.getByte(idx); // 读取类型标识符
        
        switch (type) {
            case '+': return parseSimpleString(in);
            case '-': return parseError(in);
            case ':': return parseInteger(in);
            case '$': return parseBulkString(in);
            case '*': return parseArray(in);
            default: return null; // 未知的类型
        }
    }

    /**
     * 解析简单字符串
     * 格式：+<string>\r\n
     * 
     * @param in - ByteBuf
     * @return 字符串值或 null（数据不完整）
     */
    private Object parseSimpleString(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1); // 查找分隔符 \r\n
        if (end == -1) return null; // 未找到，数据不完整
        
        // 提取字符串内容（跳过 '+'）
        String str = in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8);
        in.readerIndex(end + 2); // 移动读取位置（跳过 \r\n）
        return str;
    }

    /**
     * 解析错误消息
     * 格式：-<error message>\r\n
     * 
     * @param in - ByteBuf
     * @return RuntimeException 对象或 null
     * 
     * 返回异常对象便于错误处理
     */
    private Object parseError(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1);
        if (end == -1) return null;
        
        String msg = in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8);
        in.readerIndex(end + 2);
        return new RuntimeException(msg); // 返回异常对象
    }

    /**
     * 解析整数
     * 格式：:<integer>\r\n
     * 
     * @param in - ByteBuf
     * @return Long 值或 null
     */
    private Object parseInteger(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1);
        if (end == -1) return null;
        
        // 解析整数（使用 Long 支持大数值）
        long val = Long.parseLong(in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8));
        in.readerIndex(end + 2);
        return val;
    }

    /**
     * 解析批量字符串
     * 格式：$<length>\r\n<data>\r\n
     * 
     * 特殊情况：
     * - $-1\r\n：表示 null（键不存在）
     * - $0\r\n\r\n：表示空字符串
     * 
     * @param in - ByteBuf
     * @return 字符串值或 null
     */
    private Object parseBulkString(ByteBuf in) {
        int idx = in.readerIndex();
        int endLen = indexOfCRLF(in, idx + 1); // 查找长度字段的结束
        if (endLen == -1) return null;
        
        // 解析长度
        int len = Integer.parseInt(in.toString(idx + 1, endLen - idx - 1, StandardCharsets.UTF_8));
        
        if (len == -1) {
            // $-1 表示 null
            in.readerIndex(endLen + 2);
            return null;
        }
        
        // 检查数据是否完整（包含数据 + \r\n）
        int dataStart = endLen + 2; // 数据起始位置
        if (in.readableBytes() < (dataStart - idx) + len + 2) return null;
        
        // 提取数据内容
        String str = in.toString(dataStart, len, StandardCharsets.UTF_8);
        in.readerIndex(dataStart + len + 2); // 移动到数据后的 \r\n 之后
        return str;
    }

    /**
     * 解析数组
     * 格式：*<count>\r\n<item1><item2>...
     * 
     * 数组可以包含任意类型的元素，递归解析
     * 
     * 特殊情况：
     * - *-1\r\n：表示 null 数组
     * - *0\r\n：表示空数组
     * 
     * @param in - ByteBuf
     * @return List<Object> 或 null
     */
    private Object parseArray(ByteBuf in) {
        int idx = in.readerIndex();
        int endCount = indexOfCRLF(in, idx + 1); // 查找计数字段的结束
        if (endCount == -1) return null;
        
        // 解析元素数量
        int count = Integer.parseInt(in.toString(idx + 1, endCount - idx - 1, StandardCharsets.UTF_8));
        
        if (count == -1) {
            // *-1 表示 null 数组
            in.readerIndex(endCount + 2);
            return null;
        }
        
        in.readerIndex(endCount + 2); // 移动到第一个元素
        
        // 创建列表并逐个解析元素
        List<Object> items = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            Object val = parseValue(in); // 递归解析元素
            if (val == null) {
                // 元素不完整，恢复读取位置，等待更多数据
                in.readerIndex(idx);
                return null;
            }
            items.add(val);
        }
        
        return items;
    }

    /**
     * 查找 CRLF（\r\n）分隔符的位置
     * 
     * @param in - ByteBuf
     * @param from - 查找起始位置
     * @return CRLF 的位置或 -1（未找到）
     * 
     * 手动查找而不是使用 indexOf，提高效率
     */
    private int indexOfCRLF(ByteBuf in, int from) {
        for (int i = from; i < in.writerIndex() - 1; i++) {
            if (in.getByte(i) == '\r' && in.getByte(i + 1) == '\n') {
                return i; // 找到 \r\n
            }
        }
        return -1; // 未找到
    }
}
