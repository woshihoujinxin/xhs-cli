import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lintContent, LIMITS } from '../dist/toolset/lint.js';

describe('lintContent', () => {
  it('passes clean content', () => {
    const r = lintContent({
      title: '周末逛市集的小记录',
      content: '今天去家门口的市集逛了一圈，买了束向日葵，还吃到很好吃的烤冷面。',
    });
    assert.equal(r.ok, true);
  });

  it('rejects over-length title', () => {
    const r = lintContent({ title: 'x'.repeat(LIMITS.TITLE_MAX + 1), content: '一二三四五六七八九十' });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'title.tooLong'));
  });

  it('rejects short and over-limit content', () => {
    const short = lintContent({ content: '太短了' });
    assert.equal(short.ok, false);
    const long = lintContent({ content: '好'.repeat(LIMITS.CONTENT_MAX + 1) });
    assert.equal(long.ok, false);
    assert.ok(long.issues.some((i) => i.code === 'content.tooLong'));
  });

  it('warns on risk words (not error)', () => {
    const r = lintContent({
      title: '我的效率工具分享',
      content: '最近用自动化脚本处理表格，批量改名特别省时间，分享一下流程。',
    });
    assert.equal(r.ok, true);
    const warn = r.issues.find((i) => i.code === 'risk.words');
    assert.ok(warn);
    assert.match(warn.message, /自动化|脚本|批量/);
  });

  it('warns when no topic tag', () => {
    const r = lintContent({ content: '一二三四五六七八九十' });
    assert.ok(r.issues.some((i) => i.code === 'topic.missing'));
  });

  it('checks image count bounds', () => {
    const r = lintContent({ content: '一二三四五六七八九十', imageCount: 19 });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.code === 'image.count'));
  });
});
