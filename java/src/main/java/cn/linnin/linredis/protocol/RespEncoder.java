package cn.linnin.linredis.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.MessageToByteEncoder;

import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * RESP 协议编码器（Encoder）
 * 
 * 基于 Netty 的 MessageToByteEncoder 实现：
 * - MessageToByteEncoder 将消息对象编码为字节
 * - 自动处理编码后的字节写入 Channel
 * 
 * 工作原理：
 * - encode() 方法接收对象，编码为 RESP 格式
 * - 根据对象类型选择编码方法：
 *   - String -> writeBulkString()
 *   - Long/Integer -> writeInteger()
 *   - List -> writeArray()
 *   - null -> writeNull()
 * 
 * 编码格式：
 * - 简单字符串：+OK\r\n（用于状态回复）
 * - 错误：-ERR message\r\n（用于错误消息）
 * - 整数：:100\r\n（用于数值）
 * - 批量字符串：$6\r\nfoobar\r\n（用于字符串数据）
 * - 数组：*2\r\n...（用于批量数据）
 * 
 * 性能优化：
 * - 使用 ByteBuf 直接写入字节，避免字符串拼接
 * - 预计算字节长度，减少内存分配
 */
public class RespEncoder extends MessageToByteEncoder<Object> {

    /**
     * 编码方法：将对象编码为 RESP 格式
     * 
     * @param ctx - ChannelHandlerContext
     * @param msg - 要编码的对象
     * @param out - ByteBuf，输出缓冲区
     * 
     * 编码规则：
     * - String 类型：默认使用 Bulk String 格式
     * - Long/Integer 类型：使用 Integer 格式
     * - List 类型：使用 Array 格式
     * - byte[] 类型：直接写入（已编码）
     * - 其他类型：转换为 String 后使用 Bulk String
     */
    @Override
    protected void encode(ChannelHandlerContext ctx, Object msg, ByteBuf out) {
        if (msg instanceof String) {
            writeString(out, (String) msg);
        } else if (msg instanceof Long || msg instanceof Integer) {
            writeInteger(out, (Number) msg);
        } else if (msg instanceof List) {
            writeArray(out, (List<?>) msg);
        } else if (msg instanceof byte[]) {
            // 已编码的 RESP 数据，直接写入
            out.writeBytes((byte[]) msg);
        } else {
            // 其他类型转换为 String
            writeString(out, String.valueOf(msg));
        }
    }

    /**
     * 编码简单字符串
     * 格式：+<string>\r\n
     * 
     * @param out - ByteBuf
     * @param str - 字符串内容
     * 
     * 用于简单的状态回复（如 OK、PONG）
     */
    public static void writeSimpleString(ByteBuf out, String str) {
        out.writeByte('+'); // 类型标识符
        out.writeCharSequence(str, StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'}); // 分隔符
    }

    /**
     * 编码错误消息
     * 格式：-ERR <message>\r\n
     * 
     * @param out - ByteBuf
     * @param msg - 错误消息
     */
    public static void writeError(ByteBuf out, String msg) {
        out.writeByte('-'); // 类型标识符
        out.writeCharSequence("ERR " + msg, StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    /**
     * 编码整数
     * 格式：:<integer>\r\n
     * 
     * @param out - ByteBuf
     * @param n - 整数值（支持 Long 和 Integer）
     */
    public static void writeInteger(ByteBuf out, Number n) {
        out.writeByte(':'); // 类型标识符
        out.writeCharSequence(String.valueOf(n), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    /**
     * 编码批量字符串
     * 格式：$<length>\r\n<data>\r\n
     * 
     * @param out - ByteBuf
     * @param str - 字符串内容（null 编码为 $-1\r\n）
     * 
     * 实现细节：
     * - 计算字节长度（UTF-8 编码）
     * - 先写入长度，再写入数据
     * - null 值编码为 $-1\r\n
     */
    public static void writeBulkString(ByteBuf out, String str) {
        if (str == null) {
            // null 值：$-1\r\n
            out.writeCharSequence("$-1\r\n", StandardCharsets.UTF_8);
            return;
        }
        
        // 计算字节长度
        byte[] data = str.getBytes(StandardCharsets.UTF_8);
        
        // 写入长度
        out.writeByte('$');
        out.writeCharSequence(String.valueOf(data.length), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
        
        // 写入数据
        out.writeBytes(data);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    /**
     * 编码空值
     * 格式：$-1\r\n
     * 
     * @param out - ByteBuf
     */
    public static void writeNull(ByteBuf out) {
        out.writeCharSequence("$-1\r\n", StandardCharsets.UTF_8);
    }

    /**
     * 编码数组
     * 格式：*<count>\r\n<item1><item2>...
     * 
     * @param out - ByteBuf
     * @param items - 数组元素（可以是任意类型）
     * 
     * 递归编码：
     * - 数组元素可以是嵌套数组、整数、字符串、null
     * - 根据元素类型调用相应的编码方法
     */
    public static void writeArray(ByteBuf out, List<?> items) {
        if (items == null) {
            // null 数组：*-1\r\n
            out.writeCharSequence("*-1\r\n", StandardCharsets.UTF_8);
            return;
        }
        
        // 写入元素数量
        out.writeByte('*');
        out.writeCharSequence(String.valueOf(items.size()), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
        
        // 逐个编码元素
        for (Object item : items) {
            if (item instanceof List) {
                writeArray(out, (List<?>) item); // 递归编码嵌套数组
            } else if (item instanceof Long || item instanceof Integer) {
                writeInteger(out, (Number) item);
            } else if (item == null) {
                writeNull(out);
            } else {
                writeBulkString(out, String.valueOf(item));
            }
        }
    }

    /**
     * 编码字符串（内部方法）
     * 
     * @param out - ByteBuf
     * @param str - 字符串
     * 
     * 默认使用 Bulk String 格式
     */
    private void writeString(ByteBuf out, String str) {
        writeBulkString(out, str);
    }
}
