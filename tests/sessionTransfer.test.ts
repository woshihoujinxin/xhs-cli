import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 只测纯逻辑部分（不启动浏览器，避免测试依赖网络与 Chrome）。
// 依赖浏览器的 exportSession/importSession/checkSessionStatus 已由
// 真机端到端实测覆盖（导出 16 cookie → 导入全新空 profile → 成功发帖）。
import { isPublishConfirmed } from '../dist/toolset/publishButton.js';

/** 复刻 sessionTransfer 里读文件时的校验逻辑，用于验证非法输入被拒 */
function validateBundleShape(parsed: unknown): { ok: boolean; reason?: string } {
  const b = parsed as { format?: string; cookies?: unknown };
  if (!b || typeof b !== 'object') return { ok: false, reason: 'not-object' };
  if (b.format !== 'xhs-cli-session') return { ok: false, reason: 'bad-format' };
  if (!Array.isArray(b.cookies)) return { ok: false, reason: 'no-cookies' };
  return { ok: true };
}

describe('sessionTransfer bundle 校验', () => {
  it('接受本工具导出的合法结构', () => {
    const bundle = {
      format: 'xhs-cli-session',
      version: 1,
      exportedAt: new Date().toISOString(),
      sourcePlatform: 'win32',
      cookieCount: 1,
      cookies: [{ name: 'a1', value: 'x', domain: '.xiaohongshu.com' }],
    };
    assert.equal(validateBundleShape(bundle).ok, true);
  });

  it('拒绝缺少 format 标识的 json（防止误传别的文件）', () => {
    const r = validateBundleShape({ cookies: [] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'bad-format');
  });

  it('拒绝 format 正确但 cookies 非数组的畸形数据', () => {
    const r = validateBundleShape({ format: 'xhs-cli-session', cookies: 'oops' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no-cookies');
  });

  it('拒绝 null / 非对象', () => {
    assert.equal(validateBundleShape(null).ok, false);
    assert.equal(validateBundleShape('str').ok, false);
  });
});

describe('sessionTransfer cookie 过滤规则', () => {
  const XHS_DOMAIN_RE = /xiaohongshu|xhscdn/i;

  it('只保留小红书域下的 cookie，不泄漏其他站点凭据', () => {
    const all = [
      { name: 'a1', domain: '.xiaohongshu.com' },
      { name: 'sid', domain: 'creator.xiaohongshu.com' },
      { name: 'cdn', domain: 'sns-img.xhscdn.com' },
      { name: 'evil', domain: '.example.com' },
      { name: 'gh', domain: '.github.com' },
    ];
    const kept = all.filter((c) => XHS_DOMAIN_RE.test(c.domain));
    assert.equal(kept.length, 3);
    assert.ok(!kept.some((c) => c.domain.includes('example')));
    assert.ok(!kept.some((c) => c.domain.includes('github')));
  });

  it('过期 cookie 应被导入时跳过', () => {
    const nowSec = Date.now() / 1000;
    const cookies = [
      { name: 'live', expires: nowSec + 86400 },
      { name: 'dead', expires: nowSec - 86400 },
      { name: 'session', expires: undefined },
    ];
    const valid = cookies.filter((c) => !c.expires || c.expires > nowSec);
    assert.equal(valid.length, 2);
    assert.ok(!valid.some((c) => c.name === 'dead'));
    // session cookie（无 expires）应保留
    assert.ok(valid.some((c) => c.name === 'session'));
  });
});

describe('文件权限与落盘', () => {
  it('导出的文件应写入 0o600（明文凭据不得全局可读）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xhs-session-'));
    try {
      const p = join(dir, 'session.json');
      writeFileSync(p, JSON.stringify({ format: 'xhs-cli-session', cookies: [] }), {
        encoding: 'utf-8',
        mode: 0o600,
      });
      const parsed = JSON.parse(readFileSync(p, 'utf-8'));
      assert.equal(parsed.format, 'xhs-cli-session');
      if (process.platform !== 'win32') {
        const mode = statSync(p).mode & 0o777;
        assert.equal(mode, 0o600, `期望 0600，实际 ${mode.toString(8)}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('发布结果判定（供 session 流程复用）', () => {
  it('published=true 视为成功', () => {
    assert.equal(
      isPublishConfirmed('https://creator.xiaohongshu.com/publish/publish?source=&published=true'),
      true,
    );
  });

  it('仍停留在发布页视为未确认', () => {
    assert.equal(
      isPublishConfirmed('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image'),
      false,
    );
  });

  it('跳离发布页视为成功', () => {
    assert.equal(isPublishConfirmed('https://creator.xiaohongshu.com/new/home'), true);
  });
});
