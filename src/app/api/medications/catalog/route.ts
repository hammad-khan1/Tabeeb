import { NextRequest } from 'next/server';
import { medicationRoute } from '@/services/medications/api';
import { pakistanMedicationCatalogService } from '@/services/medications/pakistan-catalog/catalog-service';

export async function GET(request: NextRequest) {
  return medicationRoute(async () => {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const brandIdParam = searchParams.get('brandId');
    const lookupParam = searchParams.get('lookup');
    const limit = Math.min(Math.max(1, Number(searchParams.get('limit')) || 20), 50);

    // 1. Detailed brand lookup by numeric sourceBrandId
    if (brandIdParam) {
      const sourceBrandId = parseInt(brandIdParam.replace(/^pmb_/, ''), 10);
      if (isNaN(sourceBrandId) || sourceBrandId <= 0) {
        return { error: 'Invalid brandId parameter' };
      }
      const details = pakistanMedicationCatalogService.getBrandDetails(sourceBrandId);
      return {
        brandId: `pmb_${sourceBrandId}`,
        sourceBrandId,
        products: details.products,
        genericIngredients: details.ingredients,
        dosageForms: details.dosageForms,
      };
    }

    // 2. Full single-medication normalization & resolution
    if (lookupParam) {
      const lookup = await pakistanMedicationCatalogService.lookupMedication(lookupParam);
      return { lookup };
    }

    // 3. Brand search (exact, prefix, fuzzy)
    if (!query.trim()) {
      return {
        brands: [],
        disclaimer: 'Search Pakistani medicine brands to view formulations, strengths, and generic ingredients.',
      };
    }

    const results = pakistanMedicationCatalogService.searchBrands(query, limit);

    return {
      query,
      count: results.length,
      brands: results,
      disclaimer: 'Prototype reference data derived from Pakistan pharmaceutical terminology (Pharmapedia). Verify against original prescription and clinical guidance.',
    };
  });
}
