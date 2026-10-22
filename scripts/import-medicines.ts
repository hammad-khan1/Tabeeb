import { importCatalogToPostgres } from '../src/services/medications/pakistan-catalog/importer';

const isDryRun = process.argv.includes('--dry-run');

async function main() {
  try {
    const report = await importCatalogToPostgres({ dryRun: isDryRun });

    console.log('\n======================================================');
    console.log(`  TABEEB — PHARMAPEDIA IMPORT REPORT (${isDryRun ? 'DRY-RUN' : 'LIVE'})`);
    console.log('======================================================');
    console.log(`⏱️  Duration:                  ${(report.durationMs / 1000).toFixed(2)}s`);
    console.log(`🏷️  Brands Processed:          ${report.brandsProcessed.toLocaleString()}`);
    console.log(`🔬 Ingredients Processed:     ${report.drugsProcessed.toLocaleString()}`);
    console.log(`💊 Products Processed:        ${report.productsProcessed.toLocaleString()}`);
    console.log(`🔗 Product-Ingredients:       ${report.productIngredientsProcessed.toLocaleString()}`);
    console.log(`⚠️  Unresolved Drug Codes:     ${report.unresolvedDrugReferences.toLocaleString()} (flagged as unresolved)`);
    console.log(`❌ Errors:                     ${report.errors.length}`);
    console.log('======================================================\n');

    if (report.errors.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Fatal import error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main();
