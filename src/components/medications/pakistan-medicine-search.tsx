"use client";

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Search, Pill, Building2, FlaskConical, AlertCircle, ChevronDown, ChevronUp, CheckCircle2, HelpCircle, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface BrandSearchResult {
  id: string;
  brandName: string;
  manufacturer: string | null;
  genericIngredients: string[];
  dosageForms: string[];
  matchType: 'exact' | 'prefix' | 'fuzzy';
  score: number;
}

interface ProductDetail {
  id: string;
  productName: string;
  form: string | null;
  strength: string | null;
  packing: string | null;
  tradePrice: string | null;
  retailPrice: string | null;
  verificationStatus: string;
  ingredients: Array<{
    ingredientName: string;
    strength: string | null;
    verificationStatus: string;
  }>;
}

const COMMON_PAKISTANI_BRANDS = [
  'Panadol', 'Augmentin', 'Brufen', 'Arinac', 'Flagyl', 'Risek', 'Calpol', 'Disprin', 'Sofvasc', 'Lipiget',
];

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to query medicine catalog');
  return res.json();
};

export function PakistanMedicineSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [expandedBrandId, setExpandedBrandId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [query]);

  const { data, error, isLoading } = useSWR<{ brands: BrandSearchResult[] }>(
    debouncedQuery ? `/api/medications/catalog?q=${encodeURIComponent(debouncedQuery)}&limit=25` : null,
    fetcher
  );

  const displayResults = debouncedQuery ? data?.brands || [] : [];

  const { data: expandedData, isLoading: loadingProducts } = useSWR<{ products: ProductDetail[] }>(
    expandedBrandId ? `/api/medications/catalog?brandId=${encodeURIComponent(expandedBrandId)}` : null,
    fetcher
  );

  const toggleExpandBrand = (brandId: string) => {
    setExpandedBrandId((prev) => (prev === brandId ? null : brandId));
  };

  return (
    <div className="space-y-6">
      {/* Header and Guidance */}
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 dark:border-emerald-500/30 dark:bg-emerald-950/20">
        <div className="flex items-start gap-3">
          <Pill className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Pakistan Pharmaceutical Catalog (Pharmapedia)</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Search over 23,000 Pakistani medicine brands, 33,000 formulations, and 1,900 active generic ingredients.
              Compare available strengths, dosage forms, manufacturers, and identify combination medicines.
            </p>
          </div>
        </div>
      </div>

      {/* Search Input & Quick Chips */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            placeholder="Search Pakistani brand name (e.g. Panadol, Augmentin, Brufen, Arinac)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ps-9 h-11 text-sm bg-card"
          />
          {isLoading && (
            <div className="absolute end-3 top-1/2 -translate-y-1/2">
              <Loader2 className="size-4 animate-spin text-emerald-600 dark:text-emerald-400" />
            </div>
          )}
        </div>

        {/* Quick Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs font-medium text-muted-foreground me-1">Popular brands:</span>
          {COMMON_PAKISTANI_BRANDS.map((brand) => (
            <button
              key={brand}
              type="button"
              onClick={() => setQuery(brand)}
              className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs font-medium text-foreground transition-colors hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-700 dark:hover:text-emerald-300"
            >
              {brand}
            </button>
          ))}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error.message || 'Error searching catalog'}</span>
        </div>
      )}

      {/* Results List */}
      {displayResults.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <span>Found {displayResults.length} matching brands for &ldquo;{debouncedQuery}&rdquo;</span>
            <span>Click any brand to view formulations & strengths</span>
          </div>

          <div className="grid gap-3">
            {displayResults.map((brand) => {
              const isExpanded = expandedBrandId === brand.id;
              const products = isExpanded ? (expandedData?.products || []) : [];
              const isLoadingThis = isExpanded && loadingProducts;

              return (
                <div
                  key={brand.id}
                  className="rounded-xl border border-border bg-card transition-all shadow-xs hover:border-emerald-500/40"
                >
                  <button
                    type="button"
                    onClick={() => toggleExpandBrand(brand.id)}
                    className="flex w-full items-start justify-between p-4 text-start"
                  >
                    <div className="space-y-1.5 flex-1 pe-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-foreground">{brand.brandName}</span>
                        {brand.matchType === 'exact' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="size-3" /> Exact Match
                          </span>
                        ) : brand.matchType === 'fuzzy' ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                            <HelpCircle className="size-3" /> Candidate Match ({Math.round(brand.score * 100)}%)
                          </span>
                        ) : null}
                      </div>

                      {/* Generic Active Ingredients */}
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <FlaskConical className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span className="font-medium text-foreground">Generic:</span>
                        {brand.genericIngredients.length > 0 ? (
                          brand.genericIngredients.map((gen, idx) => (
                            <span
                              key={idx}
                              className="rounded-md bg-muted px-2 py-0.5 font-medium text-foreground/90"
                            >
                              {gen}
                            </span>
                          ))
                        ) : (
                          <span className="italic text-muted-foreground">Unresolved active ingredient reference</span>
                        )}
                      </div>

                      {/* Manufacturer and Dosage forms */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-0.5">
                        {brand.manufacturer && (
                          <span className="flex items-center gap-1">
                            <Building2 className="size-3.5 shrink-0" />
                            {brand.manufacturer}
                          </span>
                        )}
                        {brand.dosageForms.length > 0 && (
                          <span>
                            Forms: <strong className="text-foreground/80">{brand.dosageForms.join(', ')}</strong>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 text-muted-foreground pt-1">
                      {isExpanded ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                    </div>
                  </button>

                  {/* Expanded Formulations Table */}
                  {isExpanded && (
                    <div className="border-t border-border/60 bg-muted/20 p-4">
                      {isLoadingThis ? (
                        <div className="flex items-center justify-center py-6 gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-4 animate-spin text-emerald-600" />
                          <span>Loading formulations & strengths...</span>
                        </div>
                      ) : products.length > 0 ? (
                        <div className="space-y-3">
                          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                            Available Formulations & Strengths ({products.length})
                          </h4>
                          <div className="overflow-x-auto rounded-lg border border-border/60">
                            <table className="w-full text-xs text-start">
                              <thead className="bg-muted/60 text-muted-foreground border-b border-border/60">
                                <tr>
                                  <th className="py-2 px-3 text-start font-semibold">Dosage Form</th>
                                  <th className="py-2 px-3 text-start font-semibold">Strength</th>
                                  <th className="py-2 px-3 text-start font-semibold">Active Ingredients</th>
                                  <th className="py-2 px-3 text-start font-semibold">Packaging</th>
                                  <th className="py-2 px-3 text-end font-semibold">Retail Price</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/40">
                                {products.map((prod) => (
                                  <tr key={prod.id} className="hover:bg-muted/30">
                                    <td className="py-2 px-3 font-medium text-foreground">
                                      {prod.form || 'N/A'}
                                    </td>
                                    <td className="py-2 px-3 text-foreground font-semibold">
                                      {prod.strength || 'N/A'}
                                    </td>
                                    <td className="py-2 px-3 text-muted-foreground">
                                      {prod.ingredients.map((ing, i) => (
                                        <div key={i} className="flex items-center gap-1">
                                          <span>{ing.ingredientName}</span>
                                          {ing.strength && <span className="text-foreground/70">({ing.strength})</span>}
                                          {ing.verificationStatus === 'unresolved' && (
                                            <span className="text-[10px] text-amber-600 dark:text-amber-400">(unresolved)</span>
                                          )}
                                        </div>
                                      ))}
                                    </td>
                                    <td className="py-2 px-3 text-muted-foreground">{prod.packing || '—'}</td>
                                    <td className="py-2 px-3 text-end tabular-nums text-foreground">
                                      {prod.retailPrice ? `PKR ${prod.retailPrice}` : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic py-2">
                          No distinct formulation breakdown recorded for this brand.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : debouncedQuery && !isLoading ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
          <Pill className="mx-auto size-8 text-muted-foreground/60" />
          <h4 className="text-sm font-semibold text-foreground">No Pakistani brands found for &ldquo;{debouncedQuery}&rdquo;</h4>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Try checking spelling or search for the generic active ingredient (e.g. Paracetamol, Ibuprofen, Omeprazole).
          </p>
        </div>
      ) : null}
    </div>
  );
}
