import { describe, it, expect } from 'vitest';
import { inspectPharmapediaDatabase } from './inspector';
import { prepareCatalogFromSQLite, importCatalogToPostgres } from './importer';

describe('Pharmapedia SQLite Inspector & Importer', () => {
  it('inspects database and detects valid schema and real counts', () => {
    const report = inspectPharmapediaDatabase();
    expect(report.columnsValid).toBe(true);
    expect(report.totalBrands).toBe(23332);
    expect(report.totalProducts).toBe(53657);
    expect(report.totalDrugs).toBe(1956);
    expect(report.totalCompanies).toBe(1199);
    expect(report.unmatchedDrugIds).toBe(782);
    expect(report.combinationProductRows).toBeGreaterThan(0);
    expect(report.dataQualityIssues.length).toBeGreaterThan(0);
  });

  it('prepares normalized catalog with combination grouping and relationship mapping', () => {
    const prepared = prepareCatalogFromSQLite();
    expect(prepared.brands.length).toBe(23332);
    expect(prepared.ingredients.length).toBe(1956);
    expect(prepared.products.length).toBe(33246);
    expect(prepared.productIngredients.length).toBe(53657);
    expect(prepared.unresolvedDrugReferences).toBe(782);

    // Verify Augmentin combination product
    const augmentinProducts = prepared.products.filter(p => p.productName.toUpperCase().includes('AUGMENTIN'));
    expect(augmentinProducts.length).toBeGreaterThan(0);
    const combination = augmentinProducts.find(p => p.ingredients.length >= 2);
    expect(combination).toBeDefined();
    expect(combination?.ingredients.some(i => i.ingredientName === 'Amoxicillin')).toBe(true);
    expect(combination?.ingredients.some(i => i.ingredientName === 'Clavulanic Acid')).toBe(true);
  });

  it('runs dry-run import without writing to database', async () => {
    const report = await importCatalogToPostgres({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.brandsProcessed).toBe(23332);
    expect(report.drugsProcessed).toBe(1956);
    expect(report.productsProcessed).toBe(33246);
    expect(report.errors).toEqual([]);
    expect(report.durationMs).toBeGreaterThan(0);
  });
});
