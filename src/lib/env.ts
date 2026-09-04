import path from 'path';

/**
 * Configuration is read through here rather than off `process.env` directly, so a
 * missing key fails with a readable message at the first use instead of surfacing as
 * an opaque 401 from an upstream API halfway through processing a document.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

export function databaseUrl(): string {
  return required('DATABASE_URL');
}

export function groqApiKey(): string {
  return required('GROQ_API_KEY');
}

export function pineconeApiKey(): string {
  return required('PINECONE_API_KEY');
}

/** Optional — the biomedical NER cross-check is skipped when absent. */
export function huggingFaceApiKey(): string | undefined {
  return process.env.HF_API_KEY || undefined;
}

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

/**
 * Uploads must never land under ./public — Next serves that tree statically with no
 * auth check, which would publish every patient's records to anyone with the URL.
 */
export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  const dir = configured
    ? path.resolve(configured)
    : path.join(process.cwd(), '.data', 'uploads');

  const publicDir = path.join(process.cwd(), 'public');
  if (dir === publicDir || dir.startsWith(publicDir + path.sep)) {
    throw new Error(
      `UPLOAD_DIR (${dir}) is inside ./public, which Next serves without authentication. ` +
        'Point it somewhere outside the public directory.'
    );
  }

  return dir;
}

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Required for R2/B2/MinIO; omit for plain AWS S3. */
  endpoint?: string;
  /** Key prefix, always ends with '/' when non-empty. */
  prefix: string;
}

/**
 * Object storage config, or null when the app should use local disk.
 *
 * All four core variables must be present together — a half-configured bucket that
 * silently falls back to local disk would look fine in development and lose every
 * uploaded document on the first serverless deploy.
 */
export function s3Config(): S3Config | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

  if (!bucket && !accessKeyId && !secretAccessKey) return null;

  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Object storage is partially configured. S3_BUCKET, S3_ACCESS_KEY_ID and ' +
        'S3_SECRET_ACCESS_KEY must all be set, or all be empty to use local disk.'
    );
  }

  const rawPrefix = process.env.S3_PREFIX?.trim() ?? '';
  const prefix = rawPrefix && !rawPrefix.endsWith('/') ? `${rawPrefix}/` : rawPrefix;

  return {
    bucket,
    region: process.env.S3_REGION?.trim() || 'auto',
    accessKeyId,
    secretAccessKey,
    endpoint: process.env.S3_ENDPOINT?.trim() || undefined,
    prefix,
  };
}

/**
 * Model ids are pinned in one place and overridable without a code change, because
 * hosted model ids get retired and a stale id fails every request that uses it.
 */
export const MODELS = {
  vision: process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b',
  primary: process.env.GROQ_PRIMARY_MODEL || 'openai/gpt-oss-120b',
  fast: process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
  whisper: process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo',
} as const;

/** Called from instrumentation at boot so misconfiguration surfaces before any request. */
export function assertServerConfig(): void {
  const problems: string[] = [];
  for (const name of ['DATABASE_URL', 'GROQ_API_KEY', 'PINECONE_API_KEY'] as const) {
    if (!process.env[name]) problems.push(`${name} is not set`);
  }

  try {
    // Only relevant when falling back to local disk; with object storage configured
    // the upload directory is never touched.
    if (!s3Config()) uploadDir();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  if (problems.length > 0) {
    throw new Error(
      `Tabeeb is misconfigured:\n  - ${problems.join('\n  - ')}\n` +
        'See .env.example for what each variable is and where to get it.'
    );
  }
}
