import * as Minio from 'minio';
import { env } from '../../config/env';

/**
 * Private object storage. Objects are never public: the API streams them after an
 * authorization check. Without MINIO_ENDPOINT an in-memory store is used (tests only).
 */
export interface ObjectStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function minioStore(): ObjectStore {
  const client = new Minio.Client({
    endPoint: env.MINIO_ENDPOINT!,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ROOT_USER,
    secretKey: env.MINIO_ROOT_PASSWORD,
  });
  const bucket = env.MINIO_BUCKET;
  let ready: Promise<void> | undefined;
  const ensure = () =>
    (ready ??= (async () => {
      if (!(await client.bucketExists(bucket))) await client.makeBucket(bucket);
    })().catch((e) => {
      ready = undefined;
      throw e;
    }));
  return {
    async put(key, data, contentType) {
      await ensure();
      await client.putObject(bucket, key, data, data.length, { 'Content-Type': contentType });
    },
    async get(key) {
      await ensure();
      const stream = await client.getObject(bucket, key);
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    },
    async remove(key) {
      await ensure();
      await client.removeObject(bucket, key);
    },
  };
}

function memoryStore(): ObjectStore {
  const m = new Map<string, Buffer>();
  return {
    put: async (k, d) => void m.set(k, d),
    get: async (k) => {
      const v = m.get(k);
      if (!v) throw new Error('Object not found');
      return v;
    },
    remove: async (k) => void m.delete(k),
  };
}

export const storage: ObjectStore = env.MINIO_ENDPOINT ? minioStore() : memoryStore();

/** Allowed uploads: extension → MIME type, plus magic bytes so a renamed file is rejected. */
export const ALLOWED_FILES: Record<string, { mime: string; magic?: number[] }> = {
  pdf: { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  png: { mime: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  jpeg: { mime: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  webp: { mime: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    magic: [0x50, 0x4b, 0x03, 0x04],
  },
  doc: { mime: 'application/msword', magic: [0xd0, 0xcf, 0x11, 0xe0] },
  txt: { mime: 'text/plain' },
  csv: { mime: 'text/csv' },
};

/** Returns the canonical MIME type, or null if the name/content combination is not allowed. */
export function detectFileType(filename: string, data: Buffer): string | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const spec = ALLOWED_FILES[ext];
  if (!spec || data.length === 0) return null;
  if (spec.magic && !spec.magic.every((b, i) => data[i] === b)) return null;
  if (!spec.magic && data.subarray(0, 4096).includes(0)) return null; // text must not be binary
  return spec.mime;
}
