import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateArticleParams } from '../dist/toolset/postValidate.js';

describe('validateArticleParams', () => {
  it('accepts non-empty title and content', () => {
    assert.doesNotThrow(() =>
      validateArticleParams({ title: '标题', content: '一些正文内容' }),
    );
  });

  it('accepts long markdown content within the safety cap', () => {
    const longBody = '# 标题\n\n'.repeat(1) + '正文段落。\n'.repeat(5000);
    assert.doesNotThrow(() =>
      validateArticleParams({ title: '长文', content: longBody }),
    );
  });

  it('rejects empty title', () => {
    assert.throws(
      () => validateArticleParams({ title: '   ', content: 'x' }),
      /标题/,
    );
  });

  it('rejects empty content', () => {
    assert.throws(
      () => validateArticleParams({ title: 't', content: '  ' }),
      /内容/,
    );
  });

  it('rejects non-string title', () => {
    assert.throws(
      () => validateArticleParams({ title: 1 as unknown as string, content: 'x' }),
      /字符串/,
    );
  });

  it('rejects non-string content', () => {
    assert.throws(
      () =>
        validateArticleParams({
          title: 't',
          content: 42 as unknown as string,
        }),
      /字符串/,
    );
  });

  it('rejects oversized content above the safety cap', () => {
    assert.throws(
      () => validateArticleParams({ title: 't', content: 'x'.repeat(100001) }),
      /正文过长/,
    );
  });
});
