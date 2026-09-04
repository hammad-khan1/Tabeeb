import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { localStorage } from './storage';
import { uploadDir } from './env';

/**
 * Storage is the fix for the finding that uploaded medical documents were written
 * into ./public, where Next serves them statically with no auth check.
 */

let root: string;
const originalUploadDir = process.env.UPLOAD_DIR;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tabeeb-storage-'));
  process.env.UPLOAD_DIR = root;
});

afterEach(async () => {
  process.env.UPLOAD_DIR = originalUploadDir;
  await rm(root, { recursive: true, force: true });
});

describe('uploadDir', () => {
  it('refuses a directory inside ./public', () => {
    process.env.UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
    expect(() => uploadDir()).toThrow(/public/i);
  });

  it('refuses ./public itself', () => {
    process.env.UPLOAD_DIR = path.join(process.cwd(), 'public');
    expect(() => uploadDir()).toThrow(/public/i);
  });

  it('accepts a directory outside the web root', () => {
    process.env.UPLOAD_DIR = root;
    expect(uploadDir()).toBe(path.resolve(root));
  });

  it('defaults outside ./public when unset', () => {
    delete process.env.UPLOAD_DIR;
    const resolved = uploadDir();
    expect(resolved.startsWith(path.join(process.cwd(), 'public'))).toBe(false);
  });
});

describe('localStorage', () => {
  it('round-trips a file', async () => {
    const stored = await localStorage.save('user_1', 'report.pdf', Buffer.from('scan'));
    expect(await localStorage.read(stored)).toEqual(Buffer.from('scan'));
  });

  it('scopes files under the user directory', async () => {
    const stored = await localStorage.save('user_1', 'report.pdf', Buffer.from('x'));
    expect(stored).toBe(path.join('user_1', 'report.pdf'));
    expect(await readFile(path.join(root, 'user_1', 'report.pdf'), 'utf8')).toBe('x');
  });

  it('neutralises traversal in the file name', async () => {
    const stored = await localStorage.save(
      'user_1',
      '../../../etc/passwd',
      Buffer.from('x')
    );
    // The separators are collapsed, so the write stays inside the user's directory.
    expect(stored.startsWith('user_1')).toBe(true);
    expect(path.resolve(root, stored).startsWith(root)).toBe(true);
  });

  it('neutralises traversal in the user id', async () => {
    const stored = await localStorage.save('../escape', 'f.pdf', Buffer.from('x'));
    expect(path.resolve(root, stored).startsWith(root)).toBe(true);
  });

  it('rejects a traversing read rather than serving another directory', async () => {
    await writeFile(path.join(root, '..', 'outside.txt'), 'secret').catch(() => {});
    await expect(localStorage.read('../outside.txt')).rejects.toThrow(/Invalid storage path/);
  });

  it('rejects an absolute read path', async () => {
    await expect(localStorage.read('/etc/passwd')).rejects.toThrow(/Invalid storage path/);
  });

  it('deleting a missing file is not an error', async () => {
    await expect(localStorage.delete('user_1/gone.pdf')).resolves.toBeUndefined();
  });

  it('deleteAll removes everything stored for one user only', async () => {
    await localStorage.save('user_1', 'a.pdf', Buffer.from('a'));
    await localStorage.save('user_2', 'b.pdf', Buffer.from('b'));

    await localStorage.deleteAll('user_1');

    // "Delete all my data" left every uploaded scan on disk before this existed.
    await expect(localStorage.read('user_1/a.pdf')).rejects.toThrow();
    expect(await localStorage.read('user_2/b.pdf')).toEqual(Buffer.from('b'));
  });

  it('deleteAll cannot escape the upload root', async () => {
    await mkdir(path.join(root, 'keep'), { recursive: true });
    await writeFile(path.join(root, 'keep', 'file.txt'), 'kept');

    await localStorage.deleteAll('../');

    expect(await readFile(path.join(root, 'keep', 'file.txt'), 'utf8')).toBe('kept');
  });
});
