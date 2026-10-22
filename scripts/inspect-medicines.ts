import { inspectPharmapediaDatabase } from '../src/services/medications/pakistan-catalog/inspector';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

try {
  console.log('🔍 Inspecting Pharmapedia SQLite database...');
  const report = inspectPharmapediaDatabase();

  console.log('\n======================================================');
  console.log('  TABEEB — PHARMAPEDIA DATABASE INSPECTION REPORT     ');
  console.log('======================================================');
  console.log(`📁 Database Path:     ${report.databasePath}`);
  console.log(`💾 File Size:         ${formatBytes(report.fileSizeBytes)}`);
  console.log(`🕒 Inspected At:       ${report.inspectedAt}`);
  console.log(`📋 Tables Found:       ${report.tablesFound.join(', ')}`);
  console.log(`🛡️  Schema Integrity:   ${report.columnsValid ? 'VALID (all required columns present)' : 'INVALID'}`);

  console.log('\n--- Record Counts ---');
  console.log(`🏷️  Brands:             ${report.totalBrands.toLocaleString()}`);
  console.log(`💊 Products:           ${report.totalProducts.toLocaleString()}`);
  console.log(`🔬 Generic Drugs:      ${report.totalDrugs.toLocaleString()}`);
  console.log(`🏢 Manufacturers:      ${report.totalCompanies.toLocaleString()}`);
  console.log(`🧪 Combination Groups: ${report.combinationProductRows.toLocaleString()}`);

  console.log('\n--- Data Quality Analysis ---');
  console.log(`⚠️  Unmatched Generic Drug IDs (DID): ${report.unmatchedDrugIds} (orphaned/unresolved)`);
  console.log(`⚠️  Unmatched Brand IDs:              ${report.unmatchedBrandIds}`);
  console.log(`⚠️  Unmatched Company IDs:            ${report.unmatchedCompanyIds}`);
  console.log(`⚠️  Null / Empty Strengths:           ${report.nullOrEmptyStrengths}`);

  if (report.dataQualityIssues.length > 0) {
    console.log('\nDiscovered Issues:');
    report.dataQualityIssues.forEach(issue => console.log(`  • ${issue}`));
  }

  console.log('\n--- Sample Pakistani Brands & Formulations ---');
  report.sampleBrands.forEach(s => {
    console.log(`  • ${s.name.padEnd(12)} [${s.form ?? 'N/A'}] ${s.strength ?? ''} -> Generic: ${s.generic ?? 'Unresolved'} (${s.company ?? 'Unknown Mfr'})`);
  });

  console.log('======================================================\n');
} catch (error) {
  console.error('❌ Database inspection failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
