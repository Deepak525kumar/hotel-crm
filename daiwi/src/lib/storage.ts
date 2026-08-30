import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { config } from "./config.js";

/**
 * Object storage behind one narrow async interface. Two drivers:
 *
 *   s3    — production. Objects land in the shared hotelcrm-uploads bucket under
 *           the `app-builds/` prefix. The S3 SDK is imported lazily so a laptop
 *           with no AWS credentials can still run the local driver.
 *   local — a directory on disk, for development.
 *
 * Routes only ever deal in storageKey strings, so nothing above this module
 * knows or cares which driver is active.
 */

const ROOT = path.resolve(config.storageRoot);

/** Uploads are streamed here first: the IPA/APK parsers need a real file path. */
export const TMP_DIR = path.join(ROOT, "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

export function newKey(prefix: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${prefix}/${Date.now()}-${safe}`;
}

export interface ObjectStore {
  /** Uploads a file from the local filesystem and returns nothing. */
  putFile(key: string, localPath: string, contentType: string): Promise<void>;
  putBuffer(key: string, data: Buffer, contentType: string): Promise<void>;
  getStream(key: string): Promise<Readable>;
  /** Byte size, or null when the object no longer exists. */
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
}

// ── local driver ──────────────────────────────────────────────────────────────

function localPathFor(key: string): string {
  const resolved = path.resolve(ROOT, key);
  // Reject "../" traversal before it escapes the storage root.
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) {
    throw new Error("invalid storage key");
  }
  return resolved;
}

const localStore: ObjectStore = {
  async putFile(key, from) {
    const to = localPathFor(key);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await pipeline(fs.createReadStream(from), fs.createWriteStream(to));
  },
  async putBuffer(key, data) {
    const to = localPathFor(key);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    await fs.promises.writeFile(to, data);
  },
  async getStream(key) {
    return fs.createReadStream(localPathFor(key));
  },
  async size(key) {
    try {
      return (await fs.promises.stat(localPathFor(key))).size;
    } catch {
      return null;
    }
  },
  async remove(key) {
    await fs.promises.rm(localPathFor(key), { force: true });
  },
};

// ── s3 driver ─────────────────────────────────────────────────────────────────

/** Prefixes every key, so this service's objects stay in their own corner of a shared bucket. */
function s3Key(key: string): string {
  return config.s3.prefix ? `${config.s3.prefix}/${key}` : key;
}

let clientPromise: Promise<import("@aws-sdk/client-s3").S3Client> | null = null;
async function s3Client() {
  if (!clientPromise) {
    clientPromise = import("@aws-sdk/client-s3").then(
      ({ S3Client }) => new S3Client({ region: config.s3.region })
    );
  }
  return clientPromise;
}

const s3Store: ObjectStore = {
  async putFile(key, from, contentType) {
    // Upload, not PutObject: an IPA is comfortably large enough to want
    // multipart, and Upload picks the part size and concurrency for us.
    const [{ Upload }, client] = await Promise.all([import("@aws-sdk/lib-storage"), s3Client()]);
    await new Upload({
      client,
      params: {
        Bucket: config.s3.bucket,
        Key: s3Key(key),
        Body: fs.createReadStream(from),
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      },
    }).done();
  },

  async putBuffer(key, data, contentType) {
    const [{ PutObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      s3Client(),
    ]);
    await client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: s3Key(key),
        Body: data,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      })
    );
  },

  async getStream(key) {
    const [{ GetObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      s3Client(),
    ]);
    const out = await client.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: s3Key(key) })
    );
    if (!out.Body) throw new Error(`empty body for ${key}`);
    return out.Body as Readable;
  },

  async size(key) {
    const [{ HeadObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      s3Client(),
    ]);
    try {
      const out = await client.send(
        new HeadObjectCommand({ Bucket: config.s3.bucket, Key: s3Key(key) })
      );
      return out.ContentLength ?? null;
    } catch {
      return null;
    }
  },

  async remove(key) {
    const [{ DeleteObjectCommand }, client] = await Promise.all([
      import("@aws-sdk/client-s3"),
      s3Client(),
    ]);
    await client.send(
      new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: s3Key(key) })
    );
  },
};

export const storage: ObjectStore = config.storageDriver === "s3" ? s3Store : localStore;
