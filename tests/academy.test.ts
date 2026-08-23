import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadVideos, resolveTranscribeConfig } from '../dist/toolset/academy.js';
import type { AcademyCourse } from '../dist/toolset/academy.js';


describe('academy transcription config', () => {
  it('uses safe defaults for auto and CPU modes', () => {
    assert.deepEqual(resolveTranscribeConfig({}), { device: 'auto', computeType: 'int8_float32', concurrency: 1 });
    assert.deepEqual(resolveTranscribeConfig({ XHS_TRANSCRIBE_DEVICE: 'cpu' }), { device: 'cpu', computeType: 'int8', concurrency: 2 });
  });

  it('rejects invalid concurrency and CUDA oversubscription', () => {
    assert.throws(() => resolveTranscribeConfig({ XHS_TRANSCRIBE_CONCURRENCY: '9' }), /1 到 8/);
    assert.throws(() => resolveTranscribeConfig({ XHS_TRANSCRIBE_DEVICE: 'cuda', XHS_TRANSCRIBE_CONCURRENCY: '2' }), /并发为 1/);
  });
});

describe('academy video downloads', () => {
  it('records successful downloads and reuses existing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xhs-academy-'));
    const originalFetch = globalThis.fetch;
    try {
      const payload = new Uint8Array(10001);
      globalThis.fetch = (async () => new Response(payload, { status: 200 })) as typeof fetch;
      const first = await downloadVideos([{ noteId: 'abc', title: '课一', mediaUrl: 'https://example.test/a.mp4' }], dir, () => {}, 1);
      assert.deepEqual(first, { total: 1, existing: 0, downloaded: 1, failed: 0 });
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      assert.deepEqual(manifest.downloaded, ['abc']);
      const second = await downloadVideos([{ noteId: 'abc', title: '课一', mediaUrl: 'https://example.test/a.mp4' }], dir, () => {}, 1);
      assert.deepEqual(second, { total: 1, existing: 1, downloaded: 0, failed: 0 });
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records download errors on the course', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xhs-academy-'));
    const originalFetch = globalThis.fetch;
    const course: AcademyCourse = { category: 'c', title: '课二', url: 'u', noteId: 'def', type: '视频', contentChars: 0 };
    try {
      globalThis.fetch = (async () => new Response('no', { status: 403 })) as typeof fetch;
      const result = await downloadVideos([{ noteId: 'def', title: '课二', mediaUrl: 'https://example.test/b.mp4', course }], dir, () => {}, 1);
      assert.equal(result.failed, 1);
      assert.equal(course.downloadStatus, 'failed');
      assert.match(course.downloadError ?? '', /HTTP 403/);
    } finally {
      globalThis.fetch = originalFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
