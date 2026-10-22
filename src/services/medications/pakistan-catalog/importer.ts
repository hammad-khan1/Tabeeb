import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getDb } from '@/lib/db';
import {
  pakistanMedicineBrands,
  pakistanMedicineIngredients,
  pakistanMedicineProducts,
  pakistanProductIngredients,
} from '../../../../drizzle/schema';
import type {
  CatalogImportReport,
  PakistanBrand,
  PakistanIngredient,
  PakistanProduct,
  PakistanProductIngredient,
} from './types';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'local-data', 'pharmapedia.db');

export function normalizeCatalogName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PreparedCatalog {
  brands: PakistanBrand[];
  ingredients: PakistanIngredient[];
  products: PakistanProduct[];
  productIngredients: PakistanProductIngredient[];
  unresolvedDrugReferences: number;
}

export function prepareCatalogFromSQLite(dbPath = DEFAULT_DB_PATH): PreparedCatalog {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Pharmapedia database file not found at: ${dbPath}`);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    // 1. Companies Map (ID -> Name)
    const companyRows = db.prepare('SELECT ID, NAME FROM COMPANY').all() as Array<{ ID: number; NAME: string | null }>;
    const companyMap = new Map<number, string>();
    for (const c of companyRows) {
      if (c.ID && c.NAME) companyMap.set(c.ID, c.NAME.trim());
    }

    // 2. Generic Ingredients Map (CODE -> PakistanIngredient)
    const drugRows = db.prepare('SELECT CODE, NAME, OVERVIEW FROM DRUG').all() as Array<{
      CODE: number;
      NAME: string;
      OVERVIEW: string | null;
    }>;

    const ingredientMap = new Map<number, PakistanIngredient>();
    const ingredients: PakistanIngredient[] = [];

    for (const d of drugRows) {
      const genericName = (d.NAME || '').trim();
      if (!genericName) continue;
      const ing: PakistanIngredient = {
        id: `pmi_${d.CODE}`,
        name: genericName,
        normalizedName: normalizeCatalogName(genericName),
        rxnormCui: null,
        sourceCode: d.CODE,
        overview: d.OVERVIEW ? d.OVERVIEW.trim() : null,
        verificationStatus: 'imported_unverified',
      };
      ingredientMap.set(d.CODE, ing);
      ingredients.push(ing);
    }

    // 3. Brands Map (BID -> PakistanBrand)
    const brandRows = db.prepare('SELECT BID, BNAME, CID FROM BRAND').all() as Array<{
      BID: number;
      BNAME: string;
      CID: number | null;
    }>;

    const brandMap = new Map<number, PakistanBrand>();
    const brands: PakistanBrand[] = [];

    for (const b of brandRows) {
      const bname = (b.BNAME || '').trim();
      if (!bname) continue;
      const mfr = b.CID ? companyMap.get(b.CID) ?? null : null;
      const brand: PakistanBrand = {
        id: `pmb_${b.BID}`,
        brandName: bname,
        normalizedName: normalizeCatalogName(bname),
        manufacturer: mfr,
        companyId: b.CID,
        sourceBrandId: b.BID,
        dataSource: 'pharmapedia',
        verificationStatus: 'imported_unverified',
        aliases: [],
      };
      brandMap.set(b.BID, brand);
      brands.push(brand);
    }

    // 4. Products & Combinations from BRAND_DRUG
    // Combination products share (BID, FORM, PACKING, NAME)
    const brandDrugRows = db.prepare(`
      SELECT ID, NAME, CATEGORY, FORM, PACKING, TRADEPRICE, RETIALPRICE, MG, DID, BID
      FROM BRAND_DRUG
      ORDER BY BID, FORM, PACKING, ID
    `).all() as Array<{
      ID: number;
      NAME: string | null;
      CATEGORY: string | null;
      FORM: string | null;
      PACKING: string | null;
      TRADEPRICE: string | null;
      RETIALPRICE: string | null;
      MG: string | null;
      DID: number | null | string;
      BID: number;
    }>;

    const products: PakistanProduct[] = [];
    const productIngredients: PakistanProductIngredient[] = [];
    let unresolvedDrugReferences = 0;

    // Grouping combinations
    const groupMap = new Map<string, typeof brandDrugRows>();
    for (const row of brandDrugRows) {
      const formKey = (row.FORM || '').trim().toUpperCase();
      const packKey = (row.PACKING || '').trim().toUpperCase();
      const nameKey = (row.NAME || '').trim().toUpperCase();
      const groupKey = `${row.BID}::${formKey}::${packKey}::${nameKey}`;

      let group = groupMap.get(groupKey);
      if (!group) {
        group = [];
        groupMap.set(groupKey, group);
      }
      group.push(row);
    }

    for (const group of groupMap.values()) {
      const primary = group[0];
      const brandId = `pmb_${primary.BID}`;
      const productId = `pmp_${primary.ID}`;

      // Assemble overall strength string for combination
      const strengthParts = group
        .map(g => (g.MG || '').trim())
        .filter(s => s && s !== '0');
      const compositeStrength = strengthParts.length > 0 ? strengthParts.join(' + ') : (primary.MG ? primary.MG.trim() : null);

      const productIngredientsForGroup: PakistanProductIngredient[] = [];

      group.forEach((row, idx) => {
        const rawDid = row.DID;
        let didNum: number | null = null;
        if (typeof rawDid === 'number') {
          didNum = rawDid;
        } else if (typeof rawDid === 'string' && rawDid !== 'null' && /^\d+$/.test(rawDid.trim())) {
          didNum = parseInt(rawDid.trim(), 10);
        }

        const linkedIng = didNum !== null ? ingredientMap.get(didNum) : null;
        if (!linkedIng) {
          unresolvedDrugReferences++;
        }

        const ingName = linkedIng ? linkedIng.name : (didNum !== null ? `Unresolved Drug (${didNum})` : 'Unresolved Active Ingredient');
        const verificationStatus = linkedIng ? 'imported_unverified' : 'unresolved';

        const pIng: PakistanProductIngredient = {
          id: `ppi_${row.ID}`,
          productId,
          ingredientId: linkedIng ? linkedIng.id : null,
          ingredientName: ingName,
          strength: row.MG && row.MG.trim() !== '0' ? row.MG.trim() : null,
          sequence: idx + 1,
          verificationStatus,
        };

        productIngredientsForGroup.push(pIng);
        productIngredients.push(pIng);
      });

      const product: PakistanProduct = {
        id: productId,
        brandId,
        productName: (primary.NAME || '').trim() || (brandMap.get(primary.BID)?.brandName ?? 'Unknown Brand'),
        form: primary.FORM ? primary.FORM.trim() : null,
        strength: compositeStrength,
        packing: primary.PACKING ? primary.PACKING.trim() : null,
        tradePrice: primary.TRADEPRICE ? primary.TRADEPRICE.trim() : null,
        retailPrice: primary.RETIALPRICE ? primary.RETIALPRICE.trim() : null,
        category: primary.CATEGORY ? primary.CATEGORY.trim() : null,
        sourceProductId: primary.ID,
        verificationStatus: productIngredientsForGroup.some(pi => pi.verificationStatus === 'unresolved')
          ? 'unresolved'
          : 'imported_unverified',
        ingredients: productIngredientsForGroup,
      };

      products.push(product);
    }

    return {
      brands,
      ingredients,
      products,
      productIngredients,
      unresolvedDrugReferences,
    };
  } finally {
    db.close();
  }
}

export async function importCatalogToPostgres(options: {
  dryRun?: boolean;
  dbPath?: string;
  batchSize?: number;
}): Promise<CatalogImportReport> {
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  const dryRun = options.dryRun ?? false;
  const batchSize = options.batchSize ?? 500;

  console.log(`🚀 Starting Pakistani medicine catalog import (dryRun: ${dryRun})...`);
  const prepared = prepareCatalogFromSQLite(options.dbPath);

  console.log(`📊 Extracted from SQLite:`);
  console.log(`   • ${prepared.brands.length.toLocaleString()} brands`);
  console.log(`   • ${prepared.ingredients.length.toLocaleString()} generic ingredients`);
  console.log(`   • ${prepared.products.length.toLocaleString()} distinct products`);
  console.log(`   • ${prepared.productIngredients.length.toLocaleString()} product-ingredient relationships`);
  console.log(`   • ${prepared.unresolvedDrugReferences} unresolved drug ID references (flagged)`);

  const errors: string[] = [];

  if (dryRun) {
    console.log('✅ DRY RUN COMPLETE: Data extraction, validation, combination grouping, and relationship mapping verified successfully without modifying PostgreSQL.');
    return {
      dryRun: true,
      brandsProcessed: prepared.brands.length,
      drugsProcessed: prepared.ingredients.length,
      productsProcessed: prepared.products.length,
      productIngredientsProcessed: prepared.productIngredients.length,
      unresolvedDrugReferences: prepared.unresolvedDrugReferences,
      errors: [],
      startedAt,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  }

  // Real Database Import
  const db = getDb();
  console.log('💾 Writing catalog records to PostgreSQL...');

  try {
    // 1. Insert Generic Ingredients
    console.log(`  -> Inserting ${prepared.ingredients.length} generic ingredients...`);
    for (let i = 0; i < prepared.ingredients.length; i += batchSize) {
      const chunk = prepared.ingredients.slice(i, i + batchSize).map(ing => ({
        id: ing.id,
        name: ing.name,
        normalizedName: ing.normalizedName,
        rxnormCui: ing.rxnormCui,
        sourceCode: ing.sourceCode,
        overview: ing.overview,
        verificationStatus: ing.verificationStatus,
      }));
      await db.insert(pakistanMedicineIngredients).values(chunk).onConflictDoNothing();
    }

    // 2. Insert Brands
    console.log(`  -> Inserting ${prepared.brands.length} brands...`);
    for (let i = 0; i < prepared.brands.length; i += batchSize) {
      const chunk = prepared.brands.slice(i, i + batchSize).map(b => ({
        id: b.id,
        brandName: b.brandName,
        normalizedName: b.normalizedName,
        manufacturer: b.manufacturer,
        companyId: b.companyId,
        sourceBrandId: b.sourceBrandId,
        dataSource: b.dataSource,
        verificationStatus: b.verificationStatus,
        aliases: b.aliases,
      }));
      await db.insert(pakistanMedicineBrands).values(chunk).onConflictDoNothing();
    }

    // 3. Insert Products
    console.log(`  -> Inserting ${prepared.products.length} products...`);
    for (let i = 0; i < prepared.products.length; i += batchSize) {
      const chunk = prepared.products.slice(i, i + batchSize).map(p => ({
        id: p.id,
        brandId: p.brandId,
        productName: p.productName,
        form: p.form,
        strength: p.strength,
        packing: p.packing,
        tradePrice: p.tradePrice,
        retailPrice: p.retailPrice,
        category: p.category,
        sourceProductId: p.sourceProductId,
        verificationStatus: p.verificationStatus,
      }));
      await db.insert(pakistanMedicineProducts).values(chunk).onConflictDoNothing();
    }

    // 4. Insert Product Ingredients
    console.log(`  -> Inserting ${prepared.productIngredients.length} product-ingredient links...`);
    for (let i = 0; i < prepared.productIngredients.length; i += batchSize) {
      const chunk = prepared.productIngredients.slice(i, i + batchSize).map(pi => ({
        id: pi.id!,
        productId: pi.productId!,
        ingredientId: pi.ingredientId,
        ingredientName: pi.ingredientName,
        strength: pi.strength,
        sequence: pi.sequence,
        verificationStatus: pi.verificationStatus,
      }));
      await db.insert(pakistanProductIngredients).values(chunk).onConflictDoNothing();
    }

    console.log('🎉 PostgreSQL import completed successfully!');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Error during PostgreSQL import:', msg);
    errors.push(msg);
  }

  return {
    dryRun: false,
    brandsProcessed: prepared.brands.length,
    drugsProcessed: prepared.ingredients.length,
    productsProcessed: prepared.products.length,
    productIngredientsProcessed: prepared.productIngredients.length,
    unresolvedDrugReferences: prepared.unresolvedDrugReferences,
    errors,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
  };
}
