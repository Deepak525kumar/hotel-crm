import { shouldAutoUpload } from '@/lib/auto-upload-decision';

describe('shouldAutoUpload', () => {
  it('uploads a freshly picked file', () => {
    expect(shouldAutoUpload({ pendingUri: 'file://a.jpg', uploading: false, attemptedUri: null })).toBe(true);
  });

  it('does not start a second upload while one is in flight', () => {
    expect(shouldAutoUpload({ pendingUri: 'file://a.jpg', uploading: true, attemptedUri: null })).toBe(false);
  });

  // The regression this module exists for. A failed upload leaves pending set
  // and uploading false -- the exact state the effect fires on -- so without
  // the attempted guard a rejected file retries forever, with no backoff.
  it('does not retry a file it has already attempted', () => {
    expect(shouldAutoUpload({ pendingUri: 'file://a.jpg', uploading: false, attemptedUri: 'file://a.jpg' })).toBe(false);
  });

  it('uploads a different file picked after a failure', () => {
    expect(shouldAutoUpload({ pendingUri: 'file://b.jpg', uploading: false, attemptedUri: 'file://a.jpg' })).toBe(true);
  });

  it('does nothing when nothing is pending', () => {
    expect(shouldAutoUpload({ pendingUri: null, uploading: false, attemptedUri: null })).toBe(false);
    expect(shouldAutoUpload({ pendingUri: null, uploading: false, attemptedUri: 'file://a.jpg' })).toBe(false);
  });

  // Re-picking the same file after a successful upload must work; the row
  // clears `attemptedUri` when pending goes null, and this asserts the
  // decision that depends on it.
  it('uploads the same uri again once the attempt marker is cleared', () => {
    expect(shouldAutoUpload({ pendingUri: 'file://a.jpg', uploading: false, attemptedUri: null })).toBe(true);
  });
});
