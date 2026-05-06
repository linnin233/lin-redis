package cn.linnin.linredis.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.MessageToByteEncoder;

import java.nio.charset.StandardCharsets;
import java.util.List;

public class RespEncoder extends MessageToByteEncoder<Object> {

    @Override
    protected void encode(ChannelHandlerContext ctx, Object msg, ByteBuf out) {
        if (msg instanceof String) {
            writeString(out, (String) msg);
        } else if (msg instanceof Long || msg instanceof Integer) {
            writeInteger(out, (Number) msg);
        } else if (msg instanceof List) {
            writeArray(out, (List<?>) msg);
        } else if (msg instanceof byte[]) {
            out.writeBytes((byte[]) msg);
        } else {
            writeString(out, String.valueOf(msg));
        }
    }

    public static void writeSimpleString(ByteBuf out, String str) {
        out.writeByte('+');
        out.writeCharSequence(str, StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    public static void writeError(ByteBuf out, String msg) {
        out.writeByte('-');
        out.writeCharSequence("ERR " + msg, StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    public static void writeInteger(ByteBuf out, Number n) {
        out.writeByte(':');
        out.writeCharSequence(String.valueOf(n), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    public static void writeBulkString(ByteBuf out, String str) {
        if (str == null) {
            out.writeCharSequence("$-1\r\n", StandardCharsets.UTF_8);
            return;
        }
        byte[] data = str.getBytes(StandardCharsets.UTF_8);
        out.writeByte('$');
        out.writeCharSequence(String.valueOf(data.length), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
        out.writeBytes(data);
        out.writeBytes(new byte[]{'\r', '\n'});
    }

    public static void writeNull(ByteBuf out) {
        out.writeCharSequence("$-1\r\n", StandardCharsets.UTF_8);
    }

    public static void writeArray(ByteBuf out, List<?> items) {
        if (items == null) {
            out.writeCharSequence("*-1\r\n", StandardCharsets.UTF_8);
            return;
        }
        out.writeByte('*');
        out.writeCharSequence(String.valueOf(items.size()), StandardCharsets.UTF_8);
        out.writeBytes(new byte[]{'\r', '\n'});
        for (Object item : items) {
            if (item instanceof List) {
                writeArray(out, (List<?>) item);
            } else if (item instanceof Long || item instanceof Integer) {
                writeInteger(out, (Number) item);
            } else if (item == null) {
                writeNull(out);
            } else {
                writeBulkString(out, String.valueOf(item));
            }
        }
    }

    private void writeString(ByteBuf out, String str) {
        writeBulkString(out, str);
    }
}
