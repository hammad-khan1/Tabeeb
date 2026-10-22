export type CatalogVerificationStatus =
  | 'imported_unverified'
  | 'candidate_match'
  | 'manually_verified'
  | 'unresolved'
  | 'rejected';

export interface PakistanBrand {
  id: string;
  brandName: string;
  normalizedName: string;
  manufacturer: string | null;
  companyId: number | null;
  sourceBrandId: number;
  dataSource: string;
  verificationStatus: CatalogVerificationStatus;
  aliases: string[];
}

export interface PakistanIngredient {
  id: string;
  name: string;
  normalizedName: string;
  rxnormCui: string | null;
  sourceCode: number | null;
  overview: string | null;
  verificationStatus: CatalogVerificationStatus;
}

export interface PakistanProductIngredient {
  id?: string;
  productId?: string;
  ingredientId: string | null;
  ingredientName: string;
  strength: string | null;
  sequence: number;
  verificationStatus: CatalogVerificationStatus;
}

export interface PakistanProduct {
  id: string;
  brandId: string;
  productName: string;
  form: string | null;
  strength: string | null;
  packing: string | null;
  tradePrice: string | null;
  retailPrice: string | null;
  category: string | null;
  sourceProductId: number;
  verificationStatus: CatalogVerificationStatus;
  ingredients: PakistanProductIngredient[];
}

export interface PakistanCatalogLookupResult {
  source: 'pakistan_catalog' | 'rxnorm' | 'unresolved';
  brandName: string | null;
  genericName: string | null;
  ingredients: Array<{ name: string; rxcui?: string | null; strength?: string | null }>;
  dosageForm: string | null;
  strength: string | null;
  manufacturer: string | null;
  verificationStatus: CatalogVerificationStatus;
  confidenceScore: number;
  matchType: 'exact_brand' | 'normalized_brand' | 'fuzzy_candidate' | 'rxnorm_fallback' | 'unresolved';
  requiresHumanVerification: boolean;
  limitations: string[];
}

export interface CatalogInspectionReport {
  databasePath: string;
  fileSizeBytes: number;
  tablesFound: string[];
  columnsValid: boolean;
  totalBrands: number;
  totalProducts: number;
  totalDrugs: number;
  totalCompanies: number;
  unmatchedDrugIds: number;
  unmatchedBrandIds: number;
  unmatchedCompanyIds: number;
  nullOrEmptyStrengths: number;
  combinationProductRows: number;
  sampleBrands: Array<{
    name: string;
    company: string | null;
    form: string | null;
    strength: string | null;
    generic: string | null;
  }>;
  dataQualityIssues: string[];
  inspectedAt: string;
}

export interface CatalogImportReport {
  dryRun: boolean;
  brandsProcessed: number;
  drugsProcessed: number;
  productsProcessed: number;
  productIngredientsProcessed: number;
  unresolvedDrugReferences: number;
  errors: string[];
  startedAt: string;
  completedAt: string;
  durationMs: number;
}
