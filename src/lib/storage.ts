import { writeFile, readFile, mkdir, unlink, rm } from 'fs/promises';
import path from 'path';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { uploadDir, s3Config } from './env';

export interface FileStorage {
  save(userId: string, fileName: string, data: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  /** Removes everything stored for a user — used when an account is deleted. */
  deleteAll(userId: string): Promise<void>;
}

/**
 * Storage deliberately lives outside ./public: Next serves that tree statically with
 * no auth check, so a file placed there is readable by anyone who can guess the URL.
 * Documents are handed out only through /api/documents/[id]/file, which re-checks
 * ownership on every request — that holds for both backends below.
 */

// ── Shared path handling ────────────────────────────────────────────────────

/** Collapses anything a filesystem or object key could misinterpret. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  if (!cleaned) throw new Error('Invalid storage path segment');
  return cleaned.slice(0, 200);
}

function buildStoragePath(userId: string, fileName: string): string {
  return `${safeSegment(userId)}/${safeSegment(fileName)}`;
}

/** Rejects traversal and absolute paths before they reach disk or become a key. */
function assertSafeRelativePath(storagePath: string): void {
  if (
    !storagePath ||
    path.isAbsolute(storagePath) ||
    storagePath.split(/[/\\]/).some((part) => part === '..' || part === '')
  ) {
    throw new Error('Invalid storage path');
  }
}

// ── Local disk ──────────────────────────────────────────────────────────────

function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

export const localStorage: FileStorage = {
  async save(userId: string, fileName: string, data: Buffer) {
    const root = uploadDir();
    const storagePath = buildStoragePath(userId, fileName);
    const target = resolveWithin(root, storagePath);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return storagePath;
  },

  async read(storagePath: string) {
    assertSafeRelativePath(storagePath);
    return readFile(resolveWithin(uploadDir(), storagePath));
  },

  async delete(storagePath: string) {
    try {
      assertSafeRelativePath(storagePath);
      await unlink(resolveWithin(uploadDir(), storagePath));
    } catch {
      // Already gone — deleting the record is what matters.
    }
  },

  async deleteAll(userId: string) {
    try {
      await rm(resolveWithin(uploadDir(), safeSegment(userId)), {
        recursive: true,
        force: true,
      });
    } catch {
      // Nothing stored for this user.
    }
  },
};

// ── S3-compatible object storage ────────────────────────────────────────────

/**
 * Works with any S3-compatible service: AWS S3, Cloudflare R2, Backblaze B2, MinIO.
 * R2 is the usual choice at small scale — its free tier covers 10GB and it charges no
 * egress, which matters when the payload is scans a patient re-opens.
 *
 * This exists because a serverless filesystem does not persist between invocations,
 * so local disk means the app can only run on a VPS. Same interface either way, so
 * moving between them is a configuration change.
 */
class S3Storage implements FileStorage {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(config: NonNullable<ReturnType<typeof s3Config>>) {
    this.bucket = config.bucket;
    this.prefix = config.prefix;
    this.client = new S3Client({
      region: config.region,
      // R2/B2/MinIO need an explicit endpoint; plain AWS S3 does not.
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private key(storagePath: string): string {
    assertSafeRelativePath(storagePath);
    return `${this.prefix}${storagePath}`;
  }

  async save(userId: string, fileName: string, data: Buffer): Promise<string> {
    const storagePath = buildStoragePath(userId, fileName);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(storagePath),
        Body: data,
        // Medical records: encrypted at rest, and never in a shared cache.
        ServerSideEncryption: 'AES256',
        CacheControl: 'private, no-store',
      })
    );
    return storagePath;
  }

  async read(storagePath: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(storagePath) })
    );
    if (!result.Body) throw new Error('Empty object body');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(storagePath: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(storagePath) })
      );
    } catch {
      // Already gone.
    }
  }

  async deleteAll(userId: string): Promise<void> {
    const prefix = `${this.prefix}${safeSegment(userId)}/`;
    let continuationToken: string | undefined;

    // Paginated: a user with hundreds of documents exceeds one list page, and a
    // partial delete on "delete all my data" is not acceptable.
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        })
      );

      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => Boolean(key));

      if (keys.length > 0) {
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          })
        );
      }

      continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
    } while (continuationToken);
  }
}

// ── Backend selection ───────────────────────────────────────────────────────

let cached: FileStorage | null = null;

/**
 * Object storage when it is configured, local disk otherwise. Local is the right
 * default for development; deploying anywhere serverless requires the S3 variables.
 */
export function getStorage(): FileStorage {
  if (cached) return cached;
  const config = s3Config();
  cached = config ? new S3Storage(config) : localStorage;
  return cached;
}

/** Test seam. */
export function resetStorage(): void {
  cached = null;
}
