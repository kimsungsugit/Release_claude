import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
globalThis.fetch = vi.fn();

// Mock localStorage for getUsername
const storage = {};
globalThis.localStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, val) => { storage[key] = String(val); },
  removeItem: (key) => { delete storage[key]; },
};

const { api, post, buildTone, colorTone, fmtBytes, defaultCacheRoot } = await import('../api.js');

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete storage['devops_v2_user'];
  });

  it('api() calls fetch with correct path', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    });
    const result = await api('/api/health');
    expect(fetch).toHaveBeenCalledWith('/api/health', expect.objectContaining({
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
    expect(result.data).toBe('test');
  });

  it('api() throws on non-ok response', async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Server error'),
    });
    await expect(api('/api/fail')).rejects.toThrow('Server error');
  });

  it('api() includes X-User header when username is set', async () => {
    storage['devops_v2_user'] = 'testuser';
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    await api('/api/test');
    const [, options] = fetch.mock.calls[0];
    expect(options.headers['X-User']).toBe('testuser');
  });

  it('post() sends JSON body with POST method', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    await post('/api/test', { key: 'value' });
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/test');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ key: 'value' });
  });
});

describe('buildTone', () => {
  it('returns success for SUCCESS', () => {
    expect(buildTone('SUCCESS')).toBe('success');
  });

  it('returns danger for FAILURE', () => {
    expect(buildTone('FAILURE')).toBe('danger');
  });

  it('returns warning for UNSTABLE', () => {
    expect(buildTone('UNSTABLE')).toBe('warning');
  });

  it('returns neutral for null/undefined', () => {
    expect(buildTone(null)).toBe('neutral');
    expect(buildTone(undefined)).toBe('neutral');
  });
});

describe('colorTone', () => {
  it('maps blue to success', () => {
    expect(colorTone('blue')).toBe('success');
  });

  it('maps red to danger', () => {
    expect(colorTone('red')).toBe('danger');
  });

  it('maps null to neutral', () => {
    expect(colorTone(null)).toBe('neutral');
  });
});

describe('fmtBytes', () => {
  it('returns empty string for falsy', () => {
    expect(fmtBytes(0)).toBe('');
    expect(fmtBytes(null)).toBe('');
  });

  it('formats bytes', () => {
    expect(fmtBytes(500)).toBe('500 B');
  });

  it('formats kilobytes', () => {
    expect(fmtBytes(2048)).toBe('2.0 KB');
  });

  it('formats megabytes', () => {
    expect(fmtBytes(1048576)).toBe('1.0 MB');
  });
});

describe('defaultCacheRoot', () => {
  it('returns empty string for falsy input', () => {
    expect(defaultCacheRoot('')).toBe('');
    expect(defaultCacheRoot(null)).toBe('');
  });

  it('generates a slug-based cache path', () => {
    const result = defaultCacheRoot('https://jenkins.example.com/job/myproject');
    expect(result).toMatch(/^\.devops_pro_cache\//);
    expect(result).not.toContain('https://');
  });
});
