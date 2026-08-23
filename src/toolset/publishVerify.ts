import { withLoggedInPage } from '../browser/index.js';
import type { Page } from 'puppeteer-core';

export interface PublishVerifyOptions {
  browserUserDataDir?: string;
  title: string;
  timeoutMs?: number;
}

export interface PublishVerifyResult {
  verified: boolean;
  noteId?: string;
  attempts: number;
}

export const DEFAULT_VERIFY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 15_000;

/** 列表卡片标题与期望标题的匹配(忽略空白差异,大小写不敏感) */
export function titleMatches(expected: string, actual: string): boolean {
  const norm = (s: string) => (s || '').replace(/\s+/g, '').toLowerCase();
  const e = norm(expected);
  const a = norm(actual);
  return e.length > 0 && a.length > 0 && a === e;
}

interface CardBrief {
  noteId: string;
  title: string;
}

async function scanLatestCards(page: Page): Promise<CardBrief[]> {
  await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 4000));
  return await page.evaluate(() => {
    const out: Array<{ noteId: string; title: string }> = [];
    document.querySelectorAll('.note-card').forEach((el) => {
      if (out.length >= 12) return;
      const raw = el.getAttribute('data-impression') || '';
      let noteId = '';
      try {
        noteId = (JSON.parse(raw) as any)?.noteTarget?.value?.noteId ?? '';
      } catch {
        // data-impression 缺失时跳过 id
      }
      const titleEl = el.querySelector('.note-card__title');
      const title = ((titleEl?.textContent as string) || '').trim();
      if (title) out.push({ noteId, title });
    });
    return out;
  });
}

/**
 * 发布后验证：轮询创作者后台「笔记管理」列表，确认新笔记已出现。
 * 平台列表通常在发布后数十秒内可见；超时未出现返回 verified=false（可能是延迟，勿立即重发）。
 */
export async function verifyPublished(opts: PublishVerifyOptions): Promise<PublishVerifyResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  return await withLoggedInPage(async (page) => {
    while (Date.now() < deadline) {
      attempts++;
      const cards = await scanLatestCards(page);
      const hit = cards.find((c) => titleMatches(opts.title, c.title));
      if (hit) {
        return { verified: true, noteId: hit.noteId || undefined, attempts };
      }
      if (Date.now() + POLL_INTERVAL_MS > deadline) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return { verified: false, attempts };
  }, opts.browserUserDataDir);
}
