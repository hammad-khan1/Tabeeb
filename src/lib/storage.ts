import { writeFile, readFile, mkdir, unlink, rm } from 'fs/promises';
import path from 'path';
import { uploadDir } from './env';

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
 * ownership on every request.
 */

/** Rejects path traversal and absolute paths before they touch the filesystem. */
function resolveWithin(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

/** Collapses anything a filesystem could interpret; ids come from Clerk but are still untrusted. */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_');
  if (!cleaned) throw new Error('Invalid storage path segment');
  return cleaned.slice(0, 200);
}

export const localStorage: FileStorage = {
  async save(userId: string, fileName: string, data: Buffer) {
    const root = uploadDir();
    const storagePath = path.join(safeSegment(userId), safeSegment(fileName));
    const target = resolveWithin(root, storagePath);

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return storagePath;
  },

  async read(storagePath: string) {
    return readFile(resolveWithin(uploadDir(), storagePath));
  },

  async delete(storagePath: string) {
    try {
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
