import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@/lib/auth', () => ({
  getCurrentUserId: vi.fn(async () => 'test_user_id'),
  AuthError: class AuthError extends Error {
    statusCode = 401;
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  consume: vi.fn(),
  RateLimitError: class RateLimitError extends Error {
    retryAfterSeconds = 60;
  },
}));

describe('GET /api/medications/catalog', () => {
  it('returns empty list and guidance for empty query', async () => {
    const req = new NextRequest('http://localhost:3000/api/medications/catalog');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brands).toEqual([]);
    expect(body.disclaimer).toContain('Search Pakistani medicine brands');
  });

  it('searches Pakistani brands by query', async () => {
    const req = new NextRequest('http://localhost:3000/api/medications/catalog?q=Panadol');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brands.length).toBeGreaterThan(0);
    const panadol = body.brands.find((b: { brandName: string }) => b.brandName === 'PANADOL');
    expect(panadol).toBeDefined();
    expect(panadol.genericIngredients).toContain('Paracetamol');
  });

  it('returns brand formulations and products by brandId', async () => {
    const req = new NextRequest('http://localhost:3000/api/medications/catalog?brandId=1338');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brandId).toBe('pmb_1338');
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.genericIngredients).toContain('Paracetamol');
  });

  it('performs direct medication lookup and returns structured result', async () => {
    const req = new NextRequest('http://localhost:3000/api/medications/catalog?lookup=Augmentin');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.lookup.source).toBe('pakistan_catalog');
    expect(body.lookup.brandName).toBe('AUGMENTIN');
    expect(body.lookup.ingredients.some((i: { name: string }) => i.name === 'Amoxicillin')).toBe(true);
    expect(body.lookup.ingredients.some((i: { name: string }) => i.name === 'Clavulanic Acid')).toBe(true);
  });
});
