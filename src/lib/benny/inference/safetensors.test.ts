import { describe, expect, it } from "vitest";
import { parseSafetensors, requireTensor } from "./safetensors";

/** Builds a real, minimal .safetensors buffer (8-byte LE header length +
 * JSON header + raw F32 data), matching the format parseSafetensors reads --
 * a proper reader test needs a real file layout, not a mocked one. */
function buildSafetensorsBuffer(tensors: Record<string, { shape: number[]; values: number[] }>): Buffer {
  const header: Record<string, unknown> = {};
  const dataParts: Buffer[] = [];
  let offset = 0;
  for (const [name, { shape, values }] of Object.entries(tensors)) {
    const buf = Buffer.alloc(values.length * 4);
    for (let i = 0; i < values.length; i++) buf.writeFloatLE(values[i], i * 4);
    header[name] = { dtype: "F32", shape, data_offsets: [offset, offset + buf.length] };
    dataParts.push(buf);
    offset += buf.length;
  }
  const headerJson = Buffer.from(JSON.stringify(header), "utf-8");
  const headerLenBuf = Buffer.alloc(8);
  headerLenBuf.writeBigUInt64LE(BigInt(headerJson.length), 0);
  return Buffer.concat([headerLenBuf, headerJson, ...dataParts]);
}

describe("parseSafetensors", () => {
  it("parses a single F32 tensor with its correct shape and values", () => {
    const buf = buildSafetensorsBuffer({ weight: { shape: [2, 2], values: [1, 2, 3, 4] } });
    const tensors = parseSafetensors(buf);
    expect(tensors.weight.shape).toEqual([2, 2]);
    expect(Array.from(tensors.weight.data)).toEqual([1, 2, 3, 4]);
  });

  it("parses multiple tensors at their correct, independent byte offsets", () => {
    const buf = buildSafetensorsBuffer({
      first: { shape: [2], values: [1, 2] },
      second: { shape: [3], values: [10, 20, 30] },
    });
    const tensors = parseSafetensors(buf);
    expect(Array.from(tensors.first.data)).toEqual([1, 2]);
    expect(Array.from(tensors.second.data)).toEqual([10, 20, 30]);
  });

  it("skips the __metadata__ header entry rather than treating it as a tensor", () => {
    const buf = buildSafetensorsBuffer({ weight: { shape: [1], values: [1] } });
    // Inject a __metadata__ entry by rebuilding the header manually.
    const headerLen = Number(buf.readBigUInt64LE(0));
    const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf-8"));
    header.__metadata__ = { format: "pt" };
    const newHeaderJson = Buffer.from(JSON.stringify(header), "utf-8");
    const newHeaderLen = Buffer.alloc(8);
    newHeaderLen.writeBigUInt64LE(BigInt(newHeaderJson.length), 0);
    const rebuilt = Buffer.concat([newHeaderLen, newHeaderJson, buf.subarray(8 + headerLen)]);

    const tensors = parseSafetensors(rebuilt);
    expect(Object.keys(tensors)).toEqual(["weight"]);
  });

  it("throws on an unsupported dtype", () => {
    const buf = buildSafetensorsBuffer({ weight: { shape: [1], values: [1] } });
    const headerLen = Number(buf.readBigUInt64LE(0));
    const header = JSON.parse(buf.subarray(8, 8 + headerLen).toString("utf-8"));
    header.weight.dtype = "F16";
    const newHeaderJson = Buffer.from(JSON.stringify(header), "utf-8");
    const newHeaderLen = Buffer.alloc(8);
    newHeaderLen.writeBigUInt64LE(BigInt(newHeaderJson.length), 0);
    const rebuilt = Buffer.concat([newHeaderLen, newHeaderJson, buf.subarray(8 + headerLen)]);

    expect(() => parseSafetensors(rebuilt)).toThrow(/unsupported dtype/i);
  });

  it("produces a Float32Array that is safe to read regardless of the header's length (byte alignment)", () => {
    // An odd-length tensor name pads the JSON header to a length that
    // wouldn't necessarily leave the data block on a 4-byte boundary --
    // parseSafetensors copies into a fresh buffer specifically to guard
    // against this; this test would throw a RangeError if it didn't.
    const buf = buildSafetensorsBuffer({ x: { shape: [3], values: [1, 2, 3] } });
    expect(() => parseSafetensors(buf)).not.toThrow();
  });
});

describe("requireTensor", () => {
  it("returns the tensor when it exists", () => {
    const buf = buildSafetensorsBuffer({ weight: { shape: [2], values: [5, 6] } });
    const tensors = parseSafetensors(buf);
    expect(Array.from(requireTensor(tensors, "weight").data)).toEqual([5, 6]);
  });

  it("throws a descriptive error when the tensor is missing", () => {
    const buf = buildSafetensorsBuffer({ weight: { shape: [1], values: [1] } });
    const tensors = parseSafetensors(buf);
    expect(() => requireTensor(tensors, "missing_tensor")).toThrow(/missing_tensor/);
  });
});
