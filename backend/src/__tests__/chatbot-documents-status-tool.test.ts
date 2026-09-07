import { describe, it, expect, jest, beforeEach } from '@jest/globals';

/**
 * `documents.my_status` — "which documents do I still need?"
 *
 * Two properties carry this tool, and both are about the answer being TRUE
 * rather than merely well-formed:
 *
 *  1. The work-permit requirement is read from the employment record, never
 *     accepted from the caller. The HTTP route takes it from a query string,
 *     and copying that would let a `false` tell someone who cannot lawfully
 *     start work that their file is complete.
 *  2. ID_CARD and PASSPORT are ALTERNATIVES. The service reports both as
 *     missing when neither is present; rendering that flatly would tell an
 *     applicant to produce two identity documents when either will do.
 */

const mockCompleteness = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;
const mockGetByUserId = jest.fn() as jest.MockedFunction<(...a: any[]) => any>;

jest.mock('../modules/documents/service.js', () => ({
  documentService: { getDocumentCompleteness: mockCompleteness },
}));
jest.mock('../modules/employee-management/service.js', () => ({
  employeeManagementService: { getByUserId: mockGetByUserId },
}));

import {
  getMyDocumentStatus,
  describeMissingDocuments,
} from '../modules/chatbot/tools/definitions/self-service.tools.js';
import type { ActorContext } from '../modules/chatbot/tools/actor.js';

const worker = {
  userId: 'w1',
  role: 'worker',
  permissions: [],
  scope: null,
} as unknown as ActorContext;

const completeness = (over: Record<string, unknown> = {}) => ({
  worker_id: 'w1',
  work_permit_required: false,
  is_complete: false,
  missing_categories: ['TAX_NUMBER'],
  categories: {},
  document_count: 3,
  ...over,
});

describe('documents.my_status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetByUserId.mockResolvedValue({ user_id: 'w1', work_permit_required: false });
    mockCompleteness.mockResolvedValue(completeness());
  });

  it('is READ_ONLY, self-scoped, and needs no confirmation', () => {
    expect(getMyDocumentStatus.tier).toBe('READ_ONLY');
    expect(getMyDocumentStatus.scopeCheck).toBe('self');
    expect(getMyDocumentStatus.confirm).toBe(false);
  });

  it('accepts no arguments at all', () => {
    expect(getMyDocumentStatus.args.safeParse({}).success).toBe(true);
    // Not even a worker id, which is the point.
    for (const bad of [{ worker_id: 'w2' }, { workerId: 'w2' }, { userId: 'w2' }]) {
      expect(getMyDocumentStatus.args.safeParse(bad).success).toBe(false);
    }
  });

  it('asks about the actor themselves and nobody else', async () => {
    await getMyDocumentStatus.invoke({} as never, worker);

    const [, , actorId] = mockCompleteness.mock.calls[0] as [string, boolean, string, string];
    const [workerIdArg] = mockCompleteness.mock.calls[0] as [string];
    expect(workerIdArg).toBe('w1');
    expect(actorId).toBe('w1');
  });

  /**
   * THE CORRECTNESS PROPERTY. The route reads this from
   * `req.query.work_permit_required`; the record is what the real onboarding
   * gate (`submitForReview`) uses. They must not diverge.
   */
  it('takes the work-permit requirement from the employment record', async () => {
    mockGetByUserId.mockResolvedValue({ user_id: 'w1', work_permit_required: true });

    await getMyDocumentStatus.invoke({} as never, worker);

    const [, isWorkPermitRequired] = mockCompleteness.mock.calls[0] as [string, boolean];
    expect(isWorkPermitRequired).toBe(true);
  });

  it('defaults to "not required" when there is no employment record', async () => {
    // A real state — an admin has no employment record of their own. It must
    // not throw, and must not silently invent a requirement.
    mockGetByUserId.mockResolvedValue(null);

    const out = (await getMyDocumentStatus.invoke({} as never, worker)) as {
      hasEmploymentRecord?: boolean;
    };

    const [, isWorkPermitRequired] = mockCompleteness.mock.calls[0] as [string, boolean];
    expect(isWorkPermitRequired).toBe(false);
    expect(out.hasEmploymentRecord).toBe(false);
  });

  it('reports a complete file plainly', async () => {
    mockCompleteness.mockResolvedValue(
      completeness({ is_complete: true, missing_categories: [], document_count: 6 })
    );

    const out = await getMyDocumentStatus.invoke({} as never, worker);
    expect(getMyDocumentStatus.compress?.(out).summary).toMatch(
      /all required documents are on file \(6 uploaded\)/i
    );
  });

  it('names what is missing in words, not enum values', async () => {
    mockCompleteness.mockResolvedValue(
      completeness({ missing_categories: ['TAX_NUMBER', 'HEALTH_INSURANCE'] })
    );

    const summary = getMyDocumentStatus.compress?.(
      await getMyDocumentStatus.invoke({} as never, worker)
    ).summary;

    expect(summary).toMatch(/tax number/);
    expect(summary).toMatch(/health insurance/);
    expect(summary).not.toMatch(/TAX_NUMBER|HEALTH_INSURANCE/);
  });

  it('leaks no identifier into what the model sees', async () => {
    const json = JSON.stringify(
      getMyDocumentStatus.compress?.(await getMyDocumentStatus.invoke({} as never, worker))
    );
    for (const leak of ['w1', 'worker_id']) {
      expect(json).not.toContain(leak);
    }
  });
});

/**
 * ID_CARD and PASSPORT are alternatives, and the service reports BOTH as
 * missing when neither is on file. Telling an applicant to produce two
 * identity documents when either will do is a wrong answer that costs
 * somebody a trip to a government office.
 */
describe('describeMissingDocuments', () => {
  it('collapses the ID pair into one either/or item', () => {
    expect(describeMissingDocuments(['ID_CARD', 'PASSPORT'])).toEqual(['ID card or passport']);
  });

  it('keeps the pair collapsed while listing everything else', () => {
    const out = describeMissingDocuments([
      'TAX_NUMBER',
      'ID_CARD',
      'PASSPORT',
      'ADDRESS',
    ]);

    expect(out).toContain('ID card or passport');
    expect(out).not.toContain('ID card');
    expect(out).not.toContain('passport');
    expect(out).toEqual(expect.arrayContaining(['tax number', 'proof of address']));
    expect(out).toHaveLength(3);
  });

  it('does NOT collapse when only one of the two is missing', () => {
    // If a passport is on file but the ID card is separately required, that
    // is a genuine single requirement and must be named as itself.
    expect(describeMissingDocuments(['ID_CARD'])).toEqual(['ID card']);
    expect(describeMissingDocuments(['PASSPORT'])).toEqual(['passport']);
  });

  it('renders an unknown future category readably rather than as an enum', () => {
    // A new DocumentCategory must not surface as SCREAMING_SNAKE at a person.
    expect(describeMissingDocuments(['SOME_NEW_DOC'])).toEqual(['some new doc']);
  });

  it('returns nothing for a complete file', () => {
    expect(describeMissingDocuments([])).toEqual([]);
  });
});
