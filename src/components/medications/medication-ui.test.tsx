// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRConfig } from 'swr';
import { ProviderCoverage } from './provider-coverage';
import { EvidenceList, sourceDocumentUrl } from './shared';
import { MedicationDetails, MedicationRow } from './medication-details';
import { FindingCard } from './safety-findings';
import { BriefingMedicationSafety } from './briefing-safety';
import { PrescriptionComparison } from './prescription-comparison';
import { MedicationTimeline } from './medication-timeline';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { MEDICATION_STRINGS } from '@/lib/medication-i18n';
import type { MedicationDetailsResponse } from './api-types';
import type { MedicationEvaluation, SafetyFinding } from '@/services/medications/types';
import { SharedBriefingView } from '@/app/share/briefing/[token]/shared-briefing-view';
import type { SharedBriefingData } from '@/services/briefing/share';

const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';
const MEDICATION_ID = '22222222-2222-4222-8222-222222222222';
const finding: SafetyFinding = {
  id: '33333333-3333-4333-8333-333333333333', userId: 'synthetic-owner',
  category: 'missing_information', medicationIds: [MEDICATION_ID],
  title: 'Frequency is not documented', explanation: 'Ask your clinician to clarify the documented instructions.',
  certainty: 'documented', severity: null,
  evidence: [{ medicationId: MEDICATION_ID, documentId: DOCUMENT_ID, documentTitle: 'Synthetic prescription', documentDate: '2026-01', page: 2, excerpt: 'Example medicine 500 mg', kind: 'document' }],
  knowledgeSource: null, detectedAt: '2026-01-02T00:00:00Z', reviewStatus: 'open', resolutionNotes: null, current: true,
};
const evaluation: MedicationEvaluation = {
  findings: [finding], timeline: [],
  interactionCoverage: { status: 'unavailable', provider: 'No licensed provider', version: null, checkedAt: '2026-01-02T00:00:00Z', checkedPairs: 0, totalPairs: 1, limitations: ['Interaction evidence is unavailable.'] },
  limitations: [], evaluatedAt: '2026-01-02T00:00:00Z',
};
function details(): MedicationDetailsResponse {
  return {
    medication: {
      id: MEDICATION_ID, userId: 'synthetic-owner', documentId: DOCUMENT_ID,
      documentTitle: 'Synthetic prescription', documentType: 'prescription', documentDate: '2026-01',
      createdAt: '2026-01-02T00:00:00Z', name: 'Example medicine', genericName: null,
      dosage: '500 mg', frequency: null, duration: null, route: null, rxnormId: null,
      observation: { originalName: 'Example medicine', instructions: 'Original written instructions', sourcePage: 2 },
      patientStatus: null, corrections: {}, sourceActive: true,
    },
    audit: [], events: [], findings: [finding],
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function render(element: React.ReactNode) {
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, errorRetryCount: 0 }}>{element}</SWRConfig>);
  });
}
async function change(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

describe('medication UI evidence and coverage', () => {
  it('uses only valid document IDs and supported page anchors', () => {
    expect(sourceDocumentUrl(DOCUMENT_ID, 2)).toBe(`/api/documents/${DOCUMENT_ID}/file#page=2`);
    expect(sourceDocumentUrl(DOCUMENT_ID, -1)).toBe(`/api/documents/${DOCUMENT_ID}/file`);
    expect(sourceDocumentUrl(DOCUMENT_ID, 1.5)).toBe(`/api/documents/${DOCUMENT_ID}/file`);
    expect(sourceDocumentUrl('../another-patient', 2)).toBeNull();
    expect(sourceDocumentUrl(null, null)).toBeNull();
  });

  it('does not present unavailable, failed or partial coverage as a negative interaction result', () => {
    for (const status of ['unavailable', 'failed', 'unsupported', 'partial'] as const) {
      const html = renderToStaticMarkup(<ProviderCoverage coverage={{ ...evaluation.interactionCoverage, status }} limitations={[]} />);
      expect(html).toContain(status === 'partial' ? 'coverage is incomplete' : 'coverage is unavailable');
      expect(html).toContain('not a negative interaction result');
      expect(html).not.toContain('No interactions found');
    }
  });

  it('keeps partial source dates and renders quoted evidence as text', () => {
    const html = renderToStaticMarkup(<EvidenceList evidence={[{ ...finding.evidence[0], excerpt: '<script>unsafe()</script>' }]} />);
    expect(html).toContain('2026-01');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('uses only scoped source URLs in a shared briefing and contains no review controls', () => {
    const html = renderToStaticMarkup(<BriefingMedicationSafety evaluation={evaluation} sourceHref={(documentId, page) => `/api/briefing/share/synthetic-token/documents/${documentId}/file#page=${page}`} />);
    expect(html).toContain(`/api/briefing/share/synthetic-token/documents/${DOCUMENT_ID}/file#page=2`);
    expect(html).not.toContain(`/api/documents/${DOCUMENT_ID}`);
    expect(html).not.toContain('synthetic-owner');
    expect(html).not.toContain('<form');
  });

  it('explains section-limited original-source restrictions and omits source controls', () => {
    const data: SharedBriefingData = {
      title: 'Synthetic shared briefing', expiresAt: new Date('2026-02-01T00:00:00Z'),
      viewCount: 1, lastViewedAt: null, includedSections: ['medications', 'conflicts'],
      originalDocumentsAvailable: false,
      briefing: {
        generatedAt: '2026-01-02T00:00:00Z', dateRange: { from: null, to: null, isCoveredAllTime: true },
        patient: { id: 'synthetic-owner', name: 'Synthetic patient', email: 'synthetic@example.test', preferredLanguage: 'en' },
        clinicalSummary: 'Only selected sections are shared.', medicationSafety: evaluation,
        currentMedications: [{
          id: MEDICATION_ID, name: 'Example medicine', genericName: null, dosage: '500 mg',
          frequency: null, duration: null, route: null, prescribedDate: null, status: 'active',
          useStatus: 'prescribed_unconfirmed',
          prescribingDoctor: { name: 'Not documented', specialty: null, hospital: null, role: 'prescribing', isIdentified: false },
          hospital: null, sourceDocumentId: DOCUMENT_ID, sourceDocumentTitle: 'Synthetic prescription',
          sourceDocumentDate: '2026-01', sourceCitation: 'Synthetic prescription',
        }],
        historicalMedications: [], conditions: [], doctors: [], allergies: [], recentLabResults: [],
        labTrends: [], consultationsAndPlans: [], treatmentConflicts: [], uncertainties: [],
        consultationQuestions: [], doctorTimeline: [], citations: [], documentCount: 1, isPartial: true,
      },
    };
    const html = renderToStaticMarkup(<SharedBriefingView data={data} token="synthetic-token" />);
    expect(html).toContain('Original documents are withheld');
    expect(html).not.toContain('Verify in Original Document');
    expect(html).not.toContain(`/api/briefing/share/synthetic-token/documents/${DOCUMENT_ID}`);
    expect(html).not.toContain(`/api/documents/${DOCUMENT_ID}`);
  });

  it('provides English and Urdu interface copy for every medication key', () => {
    for (const [key, strings] of Object.entries(MEDICATION_STRINGS)) {
      expect(strings.en.trim(), key).not.toBe('');
      expect(strings.ur.trim(), key).not.toBe('');
      expect(strings.ur, key).not.toBe(strings.en);
    }
    const html = renderToStaticMarkup(<LocaleProvider locale="ur"><ProviderCoverage coverage={evaluation.interactionCoverage} limitations={[]} /></LocaleProvider>);
    expect(html).toContain(MEDICATION_STRINGS['medications.providerUnavailable'].ur);
  });

  it('displays the server reconciled status rather than inferring current use from extraction', () => {
    const medication = details().medication;
    medication.observation.status = 'confirmed_current';
    const html = renderToStaticMarkup(<MedicationRow medication={medication} resolvedStatus="unknown" />);
    expect(html).toContain('Unresolved status');
    expect(html).not.toContain('Patient-confirmed current');
  });
});

describe('medication UI patient workflow', () => {
  it('saves a patient correction separately and retains original documented values', async () => {
    let response = details();
    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body as string);
        response = { ...response, medication: { ...response.medication, corrections: body.corrections, patientStatus: body.status } };
      }
      return { ok: true, json: async () => response };
    });
    vi.stubGlobal('fetch', fetchMock);
    await render(<MedicationDetails medicationId={MEDICATION_ID} />);
    await vi.waitFor(() => expect(container.querySelector('form')).not.toBeNull());
    const form = container.querySelector('form')!;
    const selects = form.querySelectorAll('select');
    await change(selects[0], 'confirmed_current');
    await change(selects[1], 'dosage');
    await change(form.querySelector('input')!, '250 mg');
    await change(form.querySelector('textarea')!, 'This is the amount I report taking.');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(true));
    const [url, options] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(url).toBe(`/api/medications/${MEDICATION_ID}/confirmation`);
    expect(JSON.parse(options!.body as string)).toEqual({ status: 'confirmed_current', corrections: { dosage: '250 mg' }, note: 'This is the amount I report taking.' });
    expect(response.medication.dosage).toBe('500 mg');
    await vi.waitFor(() => expect(container.textContent).toContain('250 mg'));
    expect(container.textContent).toContain('500 mg');
    expect(container.textContent).toContain('Patient-reported information');
    expect(container.textContent).toContain('Original written instructions');
  });

  it('requires a reason before resolving a finding and submits the supported review state', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchMock);
    await render(<FindingCard finding={finding} />);
    const form = container.querySelector('form')!;
    await change(form.querySelector('select')!, 'resolved');
    expect((form.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fetchMock).not.toHaveBeenCalled();
    await change(form.querySelector('textarea')!, 'Instructions verified with the pharmacist.');
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(fetchMock).toHaveBeenCalledWith(`/api/medications/findings/${finding.id}/review`, expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ status: 'resolved', note: 'Instructions verified with the pharmacist.' }),
    }));
  });

  it('renders a retry state instead of patient details when authorization or loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    await render(<MedicationDetails medicationId={MEDICATION_ID} />);
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.textContent).toContain('could not be loaded');
    expect(container.querySelector('form')).toBeNull();
  });

  it('compares two selected documents and preserves both original evidence links', async () => {
    const secondId = '44444444-4444-4444-8444-444444444444';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        documentIds: [DOCUMENT_ID, secondId],
        differences: [{
          id: 'difference-1', medicationIds: [MEDICATION_ID, MEDICATION_ID], field: 'frequency',
          before: 'three times daily', after: 'twice daily', explanation: 'Different documented frequencies need review.',
          evidence: [finding.evidence[0], { ...finding.evidence[0], documentId: secondId }],
        }],
        onlyInFirst: [], onlyInSecond: [], limitations: ['Neither document is automatically preferred.'],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(<PrescriptionComparison documents={[
      { id: DOCUMENT_ID, title: 'First prescription', documentDate: '2026-01' },
      { id: secondId, title: 'Second prescription', documentDate: null },
    ]} medicationOptions={[{ id: MEDICATION_ID, name: 'Example medicine', status: 'prescribed_unconfirmed' }]} />);
    const selects = container.querySelectorAll('select');
    await change(selects[0], DOCUMENT_ID);
    await change(selects[1], secondId);
    await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await vi.waitFor(() => expect(container.textContent).toContain('three times daily'));
    expect(fetchMock).toHaveBeenCalledWith(`/api/medications/compare?left=${DOCUMENT_ID}&right=${secondId}`, { cache: 'no-store' });
    expect(container.textContent).toContain('twice daily');
    expect(container.querySelector(`a[href="/api/documents/${DOCUMENT_ID}/file#page=2"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/api/documents/${secondId}/file#page=2"]`)).not.toBeNull();
  });

  it('applies medication and historical timeline filters while paginating on the server', async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        events: [],
        pagination: { page: Number(new URL(url, 'https://local.test').searchParams.get('page')), pageSize: 25, total: 26, hasMore: !url.includes('page=2') },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    await render(<MedicationTimeline medicationOptions={[{ id: MEDICATION_ID, name: 'Example medicine', status: 'historical' }]} />);
    await vi.waitFor(() => expect(container.querySelector('button')).not.toBeNull());
    const selects = container.querySelectorAll('select');
    await change(selects[0], MEDICATION_ID);
    await change(selects[1], 'historical');
    await vi.waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(`view=historical&medicationId=${MEDICATION_ID}`));
    await vi.waitFor(() => expect([...container.querySelectorAll('button')].find((button) => button.textContent === 'Next')?.disabled).toBe(false));
    await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Next')!.click(); });
    await vi.waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toContain('page=2'));
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain(`view=historical&medicationId=${MEDICATION_ID}`);
  });
});
