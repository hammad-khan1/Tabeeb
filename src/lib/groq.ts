import Groq from 'groq-sdk';

let _groq: Groq | null = null;

export function getGroq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

export const groq = new Proxy({} as Groq, {
  get(_target, prop, receiver) {
    return Reflect.get(getGroq(), prop, receiver);
  },
});

export const MODELS = {
  vision: 'qwen/qwen3.8-27b',
  primary: 'openai/gpt-oss-120b',
  fast: 'openai/gpt-oss-20b',
  whisper: 'whisper-large-v3-turbo',
} as const;
