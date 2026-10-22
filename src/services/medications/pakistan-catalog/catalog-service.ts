import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { stripDrugNameNoise } from '@/services/nlp/drug-normalizer';
import type {
  PakistanBrand,
  PakistanCatalogLookupResult,
  PakistanProduct,
  PakistanProductIngredient,
} from './types';
import { normalizeCatalogName } from './importer';
import { normalizeMedicationIdentity as rxnormNormalize } from '../normalization';
import type { MedicationIdentity } from '../types';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'local-data', 'pharmapedia.db');

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const val = a[i - 1] === b[j - 1] ? row[j - 1] : Math.min(row[j - 1], prev, row[j]) + 1;
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

export class PakistanMedicationCatalogService {
  private static instance: PakistanMedicationCatalogService | null = null;
  private db: DatabaseSync | null = null;
  private dbPath: string;
  private brandCache = new Map<string, PakistanBrand | null>();
  private allBrandsCache: Array<{ id: number; name: string; norm: string; mfr: string | null }> | null = null;

  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
  }

  public static getInstance(): PakistanMedicationCatalogService {
    if (!PakistanMedicationCatalogService.instance) {
      PakistanMedicationCatalogService.instance = new PakistanMedicationCatalogService();
    }
    return PakistanMedicationCatalogService.instance;
  }

  private getSqlite(): DatabaseSync | null {
    if (this.db) return this.db;
    if (!fs.existsSync(this.dbPath)) return null;
    try {
      this.db = new DatabaseSync(this.dbPath, { readOnly: true });
      return this.db;
    } catch {
      return null;
    }
  }

  /**
   * Loads indexed brands into memory for fast fuzzy matching & prefix search.
   */
  private loadAllBrands(): Array<{ id: number; name: string; norm: string; mfr: string | null }> {
    if (this.allBrandsCache) return this.allBrandsCache;
    const db = this.getSqlite();
    if (!db) return [];

    try {
      const rows = db.prepare(`
        SELECT b.BID as id, b.BNAME as name, c.NAME as mfr
        FROM BRAND b
        LEFT JOIN COMPANY c ON b.CID = c.ID
      `).all() as Array<{ id: number; name: string; mfr: string | null }>;

      this.allBrandsCache = rows.map(r => ({
        id: r.id,
        name: r.name,
        norm: normalizeCatalogName(r.name),
        mfr: r.mfr,
      }));
      return this.allBrandsCache;
    } catch {
      return [];
    }
  }

  /**
   * Search brands by query (exact, prefix, or contains)
   */
  public searchBrands(query: string, limit = 20): Array<{
    id: string;
    brandName: string;
    manufacturer: string | null;
    genericIngredients: string[];
    dosageForms: string[];
    matchType: 'exact' | 'prefix' | 'fuzzy';
    score: number;
  }> {
    const rawClean = query.trim();
    const cleanNorm = normalizeCatalogName(rawClean);
    if (!cleanNorm) return [];

    const db = this.getSqlite();
    if (!db) return [];

    const all = this.loadAllBrands();
    const results: Array<{
      id: string;
      brandName: string;
      manufacturer: string | null;
      genericIngredients: string[];
      dosageForms: string[];
      matchType: 'exact' | 'prefix' | 'fuzzy';
      score: number;
    }> = [];

    // 1. Exact match
    const exact = all.find(b => b.norm === cleanNorm);
    if (exact) {
      const details = this.getBrandDetails(exact.id);
      results.push({
        id: `pmb_${exact.id}`,
        brandName: exact.name,
        manufacturer: exact.mfr,
        genericIngredients: details.ingredients,
        dosageForms: details.dosageForms,
        matchType: 'exact',
        score: 1.0,
      });
    }

    // 2. Prefix / Substring match
    for (const b of all) {
      if (exact && b.id === exact.id) continue;
      if (results.length >= limit) break;

      if (b.norm.startsWith(cleanNorm)) {
        const details = this.getBrandDetails(b.id);
        results.push({
          id: `pmb_${b.id}`,
          brandName: b.name,
          manufacturer: b.mfr,
          genericIngredients: details.ingredients,
          dosageForms: details.dosageForms,
          matchType: 'prefix',
          score: 0.9,
        });
      } else if (cleanNorm.length >= 4 && b.norm.includes(cleanNorm)) {
        const details = this.getBrandDetails(b.id);
        results.push({
          id: `pmb_${b.id}`,
          brandName: b.name,
          manufacturer: b.mfr,
          genericIngredients: details.ingredients,
          dosageForms: details.dosageForms,
          matchType: 'prefix',
          score: 0.8,
        });
      }
    }

    // 3. Fuzzy search for short queries with possible minor typos
    if (results.length < limit && cleanNorm.length >= 4) {
      for (const b of all) {
        if (results.some(r => r.brandName === b.name)) continue;
        if (results.length >= limit) break;

        const maxAllowedDist = cleanNorm.length >= 7 ? 2 : 1;
        const dist = levenshteinDistance(cleanNorm, b.norm);
        if (dist <= maxAllowedDist) {
          const details = this.getBrandDetails(b.id);
          const score = Math.max(0.5, 1 - dist / Math.max(cleanNorm.length, b.norm.length));
          results.push({
            id: `pmb_${b.id}`,
            brandName: b.name,
            manufacturer: b.mfr,
            genericIngredients: details.ingredients,
            dosageForms: details.dosageForms,
            matchType: 'fuzzy',
            score: Number(score.toFixed(2)),
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Retrieves products and generic ingredients for a specific brand ID.
   */
  public getBrandDetails(sourceBrandId: number): {
    products: PakistanProduct[];
    ingredients: string[];
    dosageForms: string[];
  } {
    const db = this.getSqlite();
    if (!db) return { products: [], ingredients: [], dosageForms: [] };

    try {
      const rows = db.prepare(`
        SELECT bd.ID as id, bd.NAME as name, bd.FORM as form, bd.PACKING as packing,
               bd.TRADEPRICE as tradePrice, bd.RETIALPRICE as retailPrice,
               bd.MG as strength, bd.DID as did, d.NAME as genericName
        FROM BRAND_DRUG bd
        LEFT JOIN DRUG d ON bd.DID = d.CODE
        WHERE bd.BID = ?
        ORDER BY bd.FORM, bd.PACKING, bd.ID
      `).all(sourceBrandId) as Array<{
        id: number;
        name: string | null;
        form: string | null;
        packing: string | null;
        tradePrice: string | null;
        retailPrice: string | null;
        strength: string | null;
        did: number | null | string;
        genericName: string | null;
      }>;

      const ingSet = new Set<string>();
      const formSet = new Set<string>();

      // Group by (FORM, PACKING, NAME) to handle combinations
      const groups = new Map<string, typeof rows>();
      for (const row of rows) {
        if (row.form) formSet.add(row.form.trim());
        if (row.genericName) ingSet.add(row.genericName.trim());

        const groupKey = `${(row.form || '').trim().toUpperCase()}::${(row.packing || '').trim().toUpperCase()}`;
        let g = groups.get(groupKey);
        if (!g) {
          g = [];
          groups.set(groupKey, g);
        }
        g.push(row);
      }

      const products: PakistanProduct[] = [];
      for (const group of groups.values()) {
        const primary = group[0];
        const strengthParts = group
          .map(g => (g.strength || '').trim())
          .filter(s => s && s !== '0');
        const compositeStrength = strengthParts.length > 0 ? strengthParts.join(' + ') : primary.strength;

        const pIngredients: PakistanProductIngredient[] = group.map((g, idx) => ({
          productId: `pmp_${primary.id}`,
          ingredientId: g.did ? `pmi_${g.did}` : null,
          ingredientName: g.genericName ? g.genericName.trim() : (g.did ? `Unresolved Drug (${g.did})` : 'Unresolved Active Ingredient'),
          strength: g.strength && g.strength.trim() !== '0' ? g.strength.trim() : null,
          sequence: idx + 1,
          verificationStatus: g.genericName ? 'imported_unverified' : 'unresolved',
        }));

        products.push({
          id: `pmp_${primary.id}`,
          brandId: `pmb_${sourceBrandId}`,
          productName: (primary.name || '').trim(),
          form: primary.form ? primary.form.trim() : null,
          strength: compositeStrength,
          packing: primary.packing ? primary.packing.trim() : null,
          tradePrice: primary.tradePrice ? primary.tradePrice.trim() : null,
          retailPrice: primary.retailPrice ? primary.retailPrice.trim() : null,
          category: null,
          sourceProductId: primary.id,
          verificationStatus: pIngredients.some(pi => pi.verificationStatus === 'unresolved')
            ? 'unresolved'
            : 'imported_unverified',
          ingredients: pIngredients,
        });
      }

      return {
        products,
        ingredients: Array.from(ingSet),
        dosageForms: Array.from(formSet),
      };
    } catch {
      return { products: [], ingredients: [], dosageForms: [] };
    }
  }

  /**
   * Main lookup method: Priority 1: Pakistani Catalog -> Priority 2: Fuzzy Candidate -> Priority 3: RxNorm Fallback
   */
  public async lookupMedication(inputName: string): Promise<PakistanCatalogLookupResult> {
    if (!inputName || inputName.trim().length < 2) {
      return {
        source: 'unresolved',
        brandName: null,
        genericName: null,
        ingredients: [],
        dosageForm: null,
        strength: null,
        manufacturer: null,
        verificationStatus: 'unresolved',
        confidenceScore: 0,
        matchType: 'unresolved',
        requiresHumanVerification: true,
        limitations: ['Empty or invalid medicine name provided.'],
      };
    }

    const stripped = stripDrugNameNoise(inputName);
    const cleanNorm = normalizeCatalogName(stripped || inputName);

    // PRIORITY 1: Search Pakistani Catalog for exact brand match
    const db = this.getSqlite();
    if (db) {
      const all = this.loadAllBrands();
      const exact = all.find(b => b.norm === cleanNorm);

      if (exact) {
        const details = this.getBrandDetails(exact.id);
        const primaryProduct = details.products[0];
        const ingredients = primaryProduct
          ? primaryProduct.ingredients.map(pi => ({
              name: pi.ingredientName,
              strength: pi.strength,
              rxcui: null,
            }))
          : details.ingredients.map(name => ({ name, strength: null, rxcui: null }));

        return {
          source: 'pakistan_catalog',
          brandName: exact.name,
          genericName: details.ingredients.join(' + ') || null,
          ingredients,
          dosageForm: primaryProduct?.form ?? (details.dosageForms[0] ?? null),
          strength: primaryProduct?.strength ?? null,
          manufacturer: exact.mfr,
          verificationStatus: 'imported_unverified',
          confidenceScore: 1.0,
          matchType: 'exact_brand',
          requiresHumanVerification: false,
          limitations: [
            'Recognized from Pakistani brand catalog (Pharmapedia). Clinical verification recommended for prescribed dosage and patient status.',
          ],
        };
      }

      // Check if input is a generic drug name in DRUG table
      try {
        const drugMatch = db.prepare(`
          SELECT CODE as code, NAME as name, OVERVIEW as overview
          FROM DRUG
          WHERE LOWER(NAME) = ? OR LOWER(NAME) = ?
          LIMIT 1
        `).get(cleanNorm, cleanNorm.replace(/\s+/g, '')) as { code: number; name: string } | undefined;

        if (drugMatch) {
          return {
            source: 'pakistan_catalog',
            brandName: null,
            genericName: drugMatch.name,
            ingredients: [{ name: drugMatch.name, strength: null, rxcui: null }],
            dosageForm: null,
            strength: null,
            manufacturer: null,
            verificationStatus: 'imported_unverified',
            confidenceScore: 0.95,
            matchType: 'normalized_brand',
            requiresHumanVerification: false,
            limitations: ['Matched active generic drug in Pakistani pharmaceutical terminology.'],
          };
        }
      } catch {
        // ignore and proceed to fuzzy
      }

      // PRIORITY 2: Candidate Matching (controlled fuzzy search)
      if (cleanNorm.length >= 4) {
        let bestCandidate: { brand: typeof all[0]; dist: number } | null = null;
        const maxDist = cleanNorm.length >= 7 ? 2 : 1;

        for (const b of all) {
          const dist = levenshteinDistance(cleanNorm, b.norm);
          if (dist <= maxDist) {
            if (!bestCandidate || dist < bestCandidate.dist) {
              bestCandidate = { brand: b, dist };
            }
          }
        }

        if (bestCandidate && bestCandidate.dist <= maxDist) {
          const details = this.getBrandDetails(bestCandidate.brand.id);
          const primaryProduct = details.products[0];
          const score = Math.max(0.65, 1 - bestCandidate.dist / Math.max(cleanNorm.length, bestCandidate.brand.norm.length));

          return {
            source: 'pakistan_catalog',
            brandName: bestCandidate.brand.name,
            genericName: details.ingredients.join(' + ') || null,
            ingredients: primaryProduct
              ? primaryProduct.ingredients.map(pi => ({
                  name: pi.ingredientName,
                  strength: pi.strength,
                  rxcui: null,
                }))
              : details.ingredients.map(name => ({ name, strength: null, rxcui: null })),
            dosageForm: primaryProduct?.form ?? (details.dosageForms[0] ?? null),
            strength: primaryProduct?.strength ?? null,
            manufacturer: bestCandidate.brand.mfr,
            verificationStatus: 'candidate_match',
            confidenceScore: Number(score.toFixed(2)),
            matchType: 'fuzzy_candidate',
            requiresHumanVerification: true,
            limitations: [
              `Fuzzy candidate match (distance: ${bestCandidate.dist}) for "${inputName}". Requires clinical confirmation against original prescription.`,
            ],
          };
        }
      }
    }

    // PRIORITY 3: Fall back to existing RxNorm normalization service
    try {
      const rxnormResult = await rxnormNormalize(stripped || inputName);
      if (rxnormResult.status === 'verified' && rxnormResult.normalizedName) {
        return {
          source: 'rxnorm',
          brandName: null,
          genericName: rxnormResult.normalizedName,
          ingredients: rxnormResult.ingredients.map(ing => ({
            name: ing.name,
            rxcui: ing.rxcui,
            strength: null,
          })),
          dosageForm: null,
          strength: null,
          manufacturer: null,
          verificationStatus: 'manually_verified',
          confidenceScore: 0.9,
          matchType: 'rxnorm_fallback',
          requiresHumanVerification: false,
          limitations: rxnormResult.limitations,
        };
      }
    } catch {
      // Fallback failed
    }

    return {
      source: 'unresolved',
      brandName: null,
      genericName: null,
      ingredients: [],
      dosageForm: null,
      strength: null,
      manufacturer: null,
      verificationStatus: 'unresolved',
      confidenceScore: 0,
      matchType: 'unresolved',
      requiresHumanVerification: true,
      limitations: [
        `Could not resolve "${inputName}" in the Pakistani medicine catalog or international RxNorm registry.`,
      ],
    };
  }

  /**
   * Adapts the catalog lookup result into the domain MedicationIdentity format
   * for seamless integration with existing services (observations, reconciliation, safety).
   */
  public async resolveMedicationIdentity(name: string): Promise<MedicationIdentity> {
    const lookup = await this.lookupMedication(name);

    if (lookup.source === 'pakistan_catalog' && lookup.genericName) {
      const status: MedicationIdentity['status'] =
        lookup.verificationStatus === 'candidate_match' ? 'ambiguous' : 'verified';

      return {
        status,
        normalizedName: lookup.brandName ?? lookup.genericName,
        rxcui: null,
        conceptType: lookup.brandName ? 'BN' : 'IN',
        ingredients: lookup.ingredients.map(ing => ({
          name: ing.name,
          rxcui: ing.rxcui ?? '0',
        })),
        provider: 'Pharmapedia',
        version: '1.0',
        checkedAt: new Date().toISOString(),
        limitations: lookup.limitations,
      };
    }

    if (lookup.source === 'rxnorm') {
      return {
        status: 'verified',
        normalizedName: lookup.genericName,
        rxcui: lookup.ingredients[0]?.rxcui ?? null,
        conceptType: 'IN',
        ingredients: lookup.ingredients.map(ing => ({
          name: ing.name,
          rxcui: ing.rxcui ?? '0',
        })),
        provider: 'RxNorm',
        version: null,
        checkedAt: new Date().toISOString(),
        limitations: lookup.limitations,
      };
    }

    return {
      status: 'unresolved',
      normalizedName: null,
      rxcui: null,
      conceptType: null,
      ingredients: [],
      provider: null,
      version: null,
      checkedAt: null,
      limitations: lookup.limitations,
    };
  }
}

export const pakistanMedicationCatalogService = PakistanMedicationCatalogService.getInstance();
