/**
 * Minimal reader for the .safetensors file format -- just enough to load
 * what ml/serve/export_web_weights.py produces (plain F32 tensors, no other
 * dtype). Hand-rolled rather than an npm dependency: the format is a small,
 * stable, publicly documented layout (8-byte little-endian header length +
 * a JSON header + a raw data block), not worth a dependency for.
 *
 * https://github.com/huggingface/safetensors#format
 */

export type TensorMap = Record<string, { shape: number[]; data: Float32Array }>;

interface TensorHeaderEntry {
  dtype: string;
  shape: number[];
  data_offsets: [number, number];
}

export function parseSafetensors(buffer: Buffer): TensorMap {
  const headerLength = Number(buffer.readBigUInt64LE(0));
  const headerJson = buffer.subarray(8, 8 + headerLength).toString("utf-8");
  const header = JSON.parse(headerJson) as Record<string, TensorHeaderEntry | undefined>;
  const dataStart = 8 + headerLength;

  const tensors: TensorMap = {};
  for (const [name, entry] of Object.entries(header)) {
    if (name === "__metadata__" || !entry) continue;
    if (entry.dtype !== "F32") {
      throw new Error(`safetensors: unsupported dtype ${entry.dtype} for tensor ${name} (only F32 is supported)`);
    }
    const [start, end] = entry.data_offsets;
    // Copied into a fresh, zero-offset ArrayBuffer rather than viewed
    // in-place -- Float32Array requires its backing buffer's byte offset to
    // be a multiple of 4, which a slice of the original buffer isn't
    // guaranteed to be (the header length varies).
    const byteLength = end - start;
    const owned = new ArrayBuffer(byteLength);
    buffer.copy(Buffer.from(owned), 0, dataStart + start, dataStart + end);
    tensors[name] = { shape: entry.shape, data: new Float32Array(owned) };
  }
  return tensors;
}

export function requireTensor(tensors: TensorMap, name: string): { shape: number[]; data: Float32Array } {
  const tensor = tensors[name];
  if (!tensor) {
    throw new Error(`safetensors: missing expected tensor "${name}"`);
  }
  return tensor;
}
