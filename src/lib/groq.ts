import Groq from 'groq-sdk';
import { groqApiKey, MODELS } from './env';

let _groq: Groq | null = null;

export function getGroq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: groqApiKey() });
  }
  return _groq;
}

export { MODELS };
