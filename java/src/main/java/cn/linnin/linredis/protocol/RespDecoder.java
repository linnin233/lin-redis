package cn.linnin.linredis.protocol;

import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class RespDecoder extends ByteToMessageDecoder {

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        if (in.readableBytes() == 0) return;
        int readerIndex = in.readerIndex();
        Object result = parseValue(in);
        if (result == null) {
            in.readerIndex(readerIndex);
            return;
        }
        out.add(result);
    }

    private Object parseValue(ByteBuf in) {
        if (in.readableBytes() == 0) return null;
        int idx = in.readerIndex();
        byte type = in.getByte(idx);
        switch (type) {
            case '+': return parseSimpleString(in);
            case '-': return parseError(in);
            case ':': return parseInteger(in);
            case '$': return parseBulkString(in);
            case '*': return parseArray(in);
            default: return null;
        }
    }

    private Object parseSimpleString(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1);
        if (end == -1) return null;
        String str = in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8);
        in.readerIndex(end + 2);
        return str;
    }

    private Object parseError(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1);
        if (end == -1) return null;
        String msg = in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8);
        in.readerIndex(end + 2);
        return new RuntimeException(msg);
    }

    private Object parseInteger(ByteBuf in) {
        int idx = in.readerIndex();
        int end = indexOfCRLF(in, idx + 1);
        if (end == -1) return null;
        long val = Long.parseLong(in.toString(idx + 1, end - idx - 1, StandardCharsets.UTF_8));
        in.readerIndex(end + 2);
        return val;
    }

    private Object parseBulkString(ByteBuf in) {
        int idx = in.readerIndex();
        int endLen = indexOfCRLF(in, idx + 1);
        if (endLen == -1) return null;
        int len = Integer.parseInt(in.toString(idx + 1, endLen - idx - 1, StandardCharsets.UTF_8));
        if (len == -1) {
            in.readerIndex(endLen + 2);
            return null;
        }
        int dataStart = endLen + 2;
        if (in.readableBytes() < (dataStart - idx) + len + 2) return null;
        String str = in.toString(dataStart, len, StandardCharsets.UTF_8);
        in.readerIndex(dataStart + len + 2);
        return str;
    }

    private Object parseArray(ByteBuf in) {
        int idx = in.readerIndex();
        int endCount = indexOfCRLF(in, idx + 1);
        if (endCount == -1) return null;
        int count = Integer.parseInt(in.toString(idx + 1, endCount - idx - 1, StandardCharsets.UTF_8));
        if (count == -1) {
            in.readerIndex(endCount + 2);
            return null;
        }
        in.readerIndex(endCount + 2);
        List<Object> items = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            Object val = parseValue(in);
            if (val == null) {
                in.readerIndex(idx);
                return null;
            }
            items.add(val);
        }
        return items;
    }

    private int indexOfCRLF(ByteBuf in, int from) {
        for (int i = from; i < in.writerIndex() - 1; i++) {
            if (in.getByte(i) == '\r' && in.getByte(i + 1) == '\n') return i;
        }
        return -1;
    }
}
