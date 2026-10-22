import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CatalogInspectionReport } from './types';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'local-data', 'pharmapedia.db');

export function inspectPharmapediaDatabase(dbPath = DEFAULT_DB_PATH): CatalogInspectionReport {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at: ${dbPath}`);
  }

  const stat = fs.statSync(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });

  try {
    // 1. Check tables
    const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
    const tablesFound = tableRows.map(r => r.name);

    const requiredTables = ['BRAND', 'BRAND_DRUG', 'DRUG', 'COMPANY'];
    const missingTables = requiredTables.filter(t => !tablesFound.includes(t));
    if (missingTables.length > 0) {
      throw new Error(`Pharmapedia database is missing required tables: ${missingTables.join(', ')}`);
    }

    // 2. Validate columns
    const brandCols = (db.prepare('PRAGMA table_info(BRAND)').all() as Array<{ name: string }>).map(c => c.name);
    const brandDrugCols = (db.prepare('PRAGMA table_info(BRAND_DRUG)').all() as Array<{ name: string }>).map(c => c.name);
    const drugCols = (db.prepare('PRAGMA table_info(DRUG)').all() as Array<{ name: string }>).map(c => c.name);
    const companyCols = (db.prepare('PRAGMA table_info(COMPANY)').all() as Array<{ name: string }>).map(c => c.name);

    const columnsValid =
      brandCols.includes('BID') && brandCols.includes('BNAME') &&
      brandDrugCols.includes('ID') && brandDrugCols.includes('NAME') && brandDrugCols.includes('BID') && brandDrugCols.includes('DID') &&
      drugCols.includes('CODE') && drugCols.includes('NAME') &&
      companyCols.includes('ID') && companyCols.includes('NAME');

    // 3. Count records
    const getCount = (query: string): number => {
      const res = db.prepare(query).get() as { count: number } | undefined;
      return res?.count ?? 0;
    };

    const totalBrands = getCount('SELECT COUNT(*) as count FROM BRAND');
    const totalProducts = getCount('SELECT COUNT(*) as count FROM BRAND_DRUG');
    const totalDrugs = getCount('SELECT COUNT(*) as count FROM DRUG');
    const totalCompanies = getCount('SELECT COUNT(*) as count FROM COMPANY');

    // 4. Data quality checks
    const unmatchedDrugIds = getCount(`
      SELECT COUNT(*) as count 
      FROM BRAND_DRUG bd 
      LEFT JOIN DRUG d ON bd.DID = d.CODE 
      WHERE d.CODE IS NULL
    `);

    const unmatchedBrandIds = getCount(`
      SELECT COUNT(*) as count 
      FROM BRAND_DRUG bd 
      LEFT JOIN BRAND b ON bd.BID = b.BID 
      WHERE b.BID IS NULL
    `);

    const unmatchedCompanyIds = getCount(`
      SELECT COUNT(*) as count 
      FROM BRAND b 
      LEFT JOIN COMPANY c ON b.CID = c.ID 
      WHERE c.ID IS NULL
    `);

    const nullOrEmptyStrengths = getCount(`
      SELECT COUNT(*) as count 
      FROM BRAND_DRUG 
      WHERE MG IS NULL OR TRIM(MG) = '' OR TRIM(MG) = '0'
    `);

    // Detect combination product rows (brands where a single formulation has multiple ingredients/rows)
    const combinationProductRows = getCount(`
      SELECT COUNT(*) as count FROM (
        SELECT BID, FORM, PACKING, COUNT(DISTINCT DID) as ing_count
        FROM BRAND_DRUG
        WHERE DID IS NOT NULL AND DID != 'null'
        GROUP BY BID, FORM, PACKING
        HAVING ing_count > 1
      )
    `);

    const dataQualityIssues: string[] = [];
    if (unmatchedDrugIds > 0) {
      dataQualityIssues.push(`${unmatchedDrugIds} BRAND_DRUG rows reference missing or null generic drug IDs (orphaned/unresolved active ingredients)`);
    }
    if (unmatchedBrandIds > 0) {
      dataQualityIssues.push(`${unmatchedBrandIds} BRAND_DRUG rows have missing brand relationships`);
    }
    if (unmatchedCompanyIds > 0) {
      dataQualityIssues.push(`${unmatchedCompanyIds} BRAND rows have missing company relationships`);
    }
    if (nullOrEmptyStrengths > 0) {
      dataQualityIssues.push(`${nullOrEmptyStrengths} product rows have null, empty, or zero recorded strengths`);
    }

    // 5. Sample recognizable Pakistani brands
    const sampleRows = db.prepare(`
      SELECT b.BNAME as name, c.NAME as company, bd.FORM as form, bd.MG as strength, d.NAME as generic
      FROM BRAND b
      JOIN BRAND_DRUG bd ON bd.BID = b.BID
      LEFT JOIN DRUG d ON bd.DID = d.CODE
      LEFT JOIN COMPANY c ON b.CID = c.ID
      WHERE b.BNAME IN ('PANADOL', 'BRUFEN', 'AUGMENTIN', 'DISPRIN', 'ARINAC', 'FLAGYL', 'RISEK', 'CALPOL')
      LIMIT 12
    `).all() as Array<{
      name: string;
      company: string | null;
      form: string | null;
      strength: string | null;
      generic: string | null;
    }>;

    return {
      databasePath: dbPath,
      fileSizeBytes: stat.size,
      tablesFound,
      columnsValid,
      totalBrands,
      totalProducts,
      totalDrugs,
      totalCompanies,
      unmatchedDrugIds,
      unmatchedBrandIds,
      unmatchedCompanyIds,
      nullOrEmptyStrengths,
      combinationProductRows,
      sampleBrands: sampleRows,
      dataQualityIssues,
      inspectedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}
