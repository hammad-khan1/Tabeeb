import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import path from 'path';

export interface FileStorage {
  save(userId: string, fileName: string, data: Buffer): Promise<string>;
  read(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export const localStorage: FileStorage = {
  async save(userId: string, fileName: string, data: Buffer) {
    const userDir = path.join(UPLOAD_DIR, userId);
    await mkdir(userDir, { recursive: true });
    const storagePath = path.join(userId, fileName);
    await writeFile(path.join(UPLOAD_DIR, storagePath), data);
    return storagePath;
  },

  async read(storagePath: string) {
    return readFile(path.join(UPLOAD_DIR, storagePath));
  },

  async delete(storagePath: string) {
    try {
      await unlink(path.join(UPLOAD_DIR, storagePath));
    } catch {
      // file may already be deleted
    }
  },
};
