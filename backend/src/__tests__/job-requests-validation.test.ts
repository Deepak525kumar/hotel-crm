import { describe, it, expect } from '@jest/globals';
import { ListWorkRequestsQuerySchema } from '../modules/job-requests/types.js';

/**
 * ListWorkRequestsQuerySchema's is_broadcast field: request-shape validation
 * only. An earlier attempt at this filter used z.coerce.boolean(), which
 * maps ANY non-empty string — including the literal "false" — to true
 * (Boolean("false") === true). That was rejected in review; this schema
 * uses an explicit z.enum(["true","false"]) + transform instead, so a
 * malformed query value is rejected rather than silently misparsed.
 */
describe('ListWorkRequestsQuerySchema — is_broadcast', () => {
  it('parses "true" to boolean true', () => {
    const result = ListWorkRequestsQuerySchema.safeParse({ is_broadcast: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_broadcast).toBe(true);
  });

  it('parses "false" to boolean false (not true)', () => {
    const result = ListWorkRequestsQuerySchema.safeParse({ is_broadcast: 'false' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_broadcast).toBe(false);
  });

  it('is undefined when omitted', () => {
    const result = ListWorkRequestsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.is_broadcast).toBeUndefined();
  });

  it('rejects an arbitrary non-empty string instead of coercing it to true', () => {
    const result = ListWorkRequestsQuerySchema.safeParse({ is_broadcast: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty string', () => {
    const result = ListWorkRequestsQuerySchema.safeParse({ is_broadcast: '' });
    expect(result.success).toBe(false);
  });

  it('rejects "0" and "1" (not booleans, not "true"/"false")', () => {
    expect(ListWorkRequestsQuerySchema.safeParse({ is_broadcast: '0' }).success).toBe(false);
    expect(ListWorkRequestsQuerySchema.safeParse({ is_broadcast: '1' }).success).toBe(false);
  });
});
