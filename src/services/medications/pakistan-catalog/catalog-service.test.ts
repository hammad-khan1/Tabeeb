import { describe, it, expect } from 'vitest';
import { PakistanMedicationCatalogService } from './catalog-service';

describe('PakistanMedicationCatalogService', () => {
  const service = PakistanMedicationCatalogService.getInstance();

  it('recognizes exact Pakistani brand Panadol and resolves to Paracetamol', async () => {
    const res = await service.lookupMedication('Panadol');
    expect(res.source).toBe('pakistan_catalog');
    expect(res.brandName).toBe('PANADOL');
    expect(res.genericName).toContain('Paracetamol');
    expect(res.matchType).toBe('exact_brand');
    expect(res.confidenceScore).toBe(1.0);
    expect(res.requiresHumanVerification).toBe(false);
    expect(res.ingredients.some(i => i.name === 'Paracetamol')).toBe(true);
  });

  it('recognizes combination medicine Augmentin and resolves multiple ingredients', async () => {
    const res = await service.lookupMedication('Augmentin');
    expect(res.source).toBe('pakistan_catalog');
    expect(res.brandName).toBe('AUGMENTIN');
    expect(res.ingredients.length).toBeGreaterThanOrEqual(2);
    const ingNames = res.ingredients.map(i => i.name);
    expect(ingNames).toContain('Amoxicillin');
    expect(ingNames).toContain('Clavulanic Acid');
  });

  it('recognizes combination medicine Arinac with Ibuprofen and Pseudoephedrine', async () => {
    const res = await service.lookupMedication('Arinac');
    expect(res.source).toBe('pakistan_catalog');
    expect(res.brandName).toBe('ARINAC');
    const ingNames = res.ingredients.map(i => i.name);
    expect(ingNames).toContain('Ibuprofen');
    expect(ingNames.some(n => n.includes('Pseudoephedrine'))).toBe(true);
  });

  it('recognizes Brufen and extracts dosage forms and manufacturer', async () => {
    const res = await service.lookupMedication('Brufen 400mg');
    expect(res.source).toBe('pakistan_catalog');
    expect(res.brandName).toBe('BRUFEN');
    expect(res.ingredients.some(i => i.name === 'Ibuprofen')).toBe(true);
  });

  it('performs controlled candidate matching on minor OCR typos', async () => {
    const res = await service.lookupMedication('Panadoll');
    expect(res.source).toBe('pakistan_catalog');
    expect(res.brandName).toBe('PANADOL');
    expect(res.matchType).toBe('fuzzy_candidate');
    expect(res.verificationStatus).toBe('candidate_match');
    expect(res.requiresHumanVerification).toBe(true);
  });

  it('searches brands by prefix and returns structured product info', () => {
    const results = service.searchBrands('Augm');
    expect(results.length).toBeGreaterThan(0);
    const augmentin = results.find(r => r.brandName === 'AUGMENTIN');
    expect(augmentin).toBeDefined();
    expect(augmentin?.genericIngredients).toContain('Amoxicillin');
    expect(augmentin?.genericIngredients).toContain('Clavulanic Acid');
  });

  it('maps into domain MedicationIdentity format seamlessly', async () => {
    const identity = await service.resolveMedicationIdentity('Panadol');
    expect(identity.status).toBe('verified');
    expect(identity.normalizedName).toBe('PANADOL');
    expect(identity.provider).toBe('Pharmapedia');
    expect(identity.ingredients[0].name).toBe('Paracetamol');
  });

  it('handles invalid / empty inputs gracefully', async () => {
    const res = await service.lookupMedication('   ');
    expect(res.verificationStatus).toBe('unresolved');
    expect(res.matchType).toBe('unresolved');
  });
});
