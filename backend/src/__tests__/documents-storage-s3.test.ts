import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

/**
 * SPEC-DOCUMENTS-001 @0.1.4 FROZEN -- PR #248: real S3 SDK wiring regression.
 * Every other documents test suite mocks storage.js away entirely (by design
 * -- they test authz/service logic, not storage). This suite is the first to
 * exercise storage.ts itself: the S3Client/PutObjectCommand/GetObjectCommand/
 * DeleteObjectCommand/getSignedUrl call shape, and the stub-vs-real branch
 * selection based on env.S3_BUCKET. The AWS SDK itself is mocked (no network
 * call, no real bucket needed) -- this proves the wiring is correct, not that
 * AWS credentials/connectivity work.
 */

const mockSend = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockS3ClientCtor = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockPutObjectCommand = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockGetObjectCommand = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockDeleteObjectCommand = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;
const mockGetSignedUrl = jest.fn() as jest.MockedFunction<(...args: any[]) => any>;

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    constructor(...args: any[]) {
      mockS3ClientCtor(...args);
    }
    send(...args: any[]) {
      return mockSend(...args);
    }
  },
  PutObjectCommand: class {
    constructor(input: any) {
      mockPutObjectCommand(input);
      Object.assign(this, input);
    }
  },
  GetObjectCommand: class {
    constructor(input: any) {
      mockGetObjectCommand(input);
      Object.assign(this, input);
    }
  },
  DeleteObjectCommand: class {
    constructor(input: any) {
      mockDeleteObjectCommand(input);
      Object.assign(this, input);
    }
  },
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

jest.mock('../lib/logger.js', () => ({
  logger: {
    info: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    warn: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    debug: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
    error: jest.fn() as jest.MockedFunction<(...args: any[]) => any>,
  },
}));

const ORIGINAL_ENV = { ...process.env };

describe('documents/storage.ts (PR #248 real S3 wiring)', () => {
  beforeEach(() => {
    jest.resetModules();
    mockSend.mockReset();
    mockS3ClientCtor.mockReset();
    mockPutObjectCommand.mockReset();
    mockGetObjectCommand.mockReset();
    mockDeleteObjectCommand.mockReset();
    mockGetSignedUrl.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the stub client when S3_BUCKET is not configured (test/CI posture unchanged)', async () => {
    delete process.env['S3_BUCKET'];
    const { getStorageClient } = await import('../modules/documents/storage.js');
    const client = await getStorageClient();

    await client.upload('k', Buffer.from('x'), 'application/pdf');
    expect(mockS3ClientCtor).not.toHaveBeenCalled();

    const url = await client.getPresignedUrl('k');
    expect(url).toBeNull();
  });

  it('builds a real S3 client when S3_BUCKET is configured, using AWS_REGION', async () => {
    process.env['S3_BUCKET'] = 'hotelcrm-uploads';
    process.env['AWS_REGION'] = 'eu-central-1';
    mockSend.mockResolvedValue({});

    const { getStorageClient } = await import('../modules/documents/storage.js');
    const client = await getStorageClient();

    expect(mockS3ClientCtor).toHaveBeenCalledWith({ region: 'eu-central-1' });

    await client.upload('documents/w1/general/uuid/id.pdf', Buffer.from('hello'), 'application/pdf');
    expect(mockPutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'hotelcrm-uploads',
        Key: 'documents/w1/general/uuid/id.pdf',
        ContentType: 'application/pdf',
        // OD-DOC-017: SSE-S3 encryption at rest, explicitly set.
        ServerSideEncryption: 'AES256',
      })
    );
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('generates a presigned GET URL scoped to the bucket/key with the documented 15-minute TTL', async () => {
    process.env['S3_BUCKET'] = 'hotelcrm-uploads';
    mockGetSignedUrl.mockResolvedValue('https://s3.example/presigned');

    const { getStorageClient } = await import('../modules/documents/storage.js');
    const client = await getStorageClient();

    const url = await client.getPresignedUrl('documents/w1/general/uuid/id.pdf');

    expect(mockGetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'hotelcrm-uploads', Key: 'documents/w1/general/uuid/id.pdf' })
    );
    expect(mockGetSignedUrl).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ expiresIn: 15 * 60 })
    );
    expect(url).toBe('https://s3.example/presigned');
  });

  it('deletes an object scoped to the configured bucket', async () => {
    process.env['S3_BUCKET'] = 'hotelcrm-uploads';
    mockSend.mockResolvedValue({});

    const { getStorageClient } = await import('../modules/documents/storage.js');
    const client = await getStorageClient();
    await client.delete('documents/w1/general/uuid/id.pdf');

    expect(mockDeleteObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'hotelcrm-uploads', Key: 'documents/w1/general/uuid/id.pdf' })
    );
  });

  it('reuses the same client instance across calls within a process (lazy singleton)', async () => {
    process.env['S3_BUCKET'] = 'hotelcrm-uploads';
    mockSend.mockResolvedValue({});

    const { getStorageClient } = await import('../modules/documents/storage.js');
    await getStorageClient();
    await getStorageClient();

    expect(mockS3ClientCtor).toHaveBeenCalledTimes(1);
  });
});
