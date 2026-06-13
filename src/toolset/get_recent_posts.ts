import type { Page, ElementHandle } from 'puppeteer-core';
import { withLoggedInPage } from '../browser/index.js';
import { saveToCache, loadFromCache } from '../utils/cache.js';
import { prefixedCacheFilename } from './cachePaths.js';
import type { ResolvedSession } from './sessionTypes.js';

interface NoteRaw {
  noteId: string;
  title: string;
  publishTime: string;
  url: string;
  tag: string;          // 审核状态(审核中/已发布/已下架),新版创作者后台才有
  views: string;
  likes: string;
  comments: string;
  favorites: string;
  shares: string;
  coverImage: string;
}

function formatNote(note: NoteRaw): string {
  const tag = note.tag ? `  [${note.tag}]` : '';
  return [
    `ID: ${note.noteId}${tag}`,
    `标题: ${note.title}`,
    `发布时间: ${note.publishTime}`,
    `链接: ${note.url}`,
    `浏览: ${note.views}  点赞: ${note.likes}  评论: ${note.comments}  收藏: ${note.favorites}  分享: ${note.shares}`,
  ].join('\n');
}

// 新版小红书创作者后台(.note-card)的互动数提取
// 5 个 .note-card__stat 按顺序:浏览/点赞/评论/收藏/分享
async function getNewInteractions(page: Page, card: ElementHandle): Promise<{
  views: string; likes: string; comments: string; favorites: string; shares: string;
}> {
  return await page.evaluate((el) => {
    const stats = el.querySelectorAll('.note-card__stat');
    const texts: string[] = Array.from(stats).map(s => {
      const span = s.querySelector('span');
      return span ? (span.textContent || '').trim() : '0';
    });
    // 兜底:有些版本互动数直接在 .note-card__stats 下的 span
    if (texts.length === 0) {
      const statsContainer = el.querySelector('.note-card__stats');
      if (statsContainer) {
        statsContainer.querySelectorAll('span').forEach(s => {
          const t = (s.textContent || '').trim();
          if (/^\d+$/.test(t)) texts.push(t);
        });
      }
    }
    while (texts.length < 5) texts.push('0');
    return {
      views: texts[0] || '0',
      likes: texts[1] || '0',
      comments: texts[2] || '0',
      favorites: texts[3] || '0',
      shares: texts[4] || '0',
    };
  }, card);
}

async function scrapeRecentPosts(
  page: Page,
  session: ResolvedSession,
  limit?: number,
): Promise<string> {
  await page.goto('https://creator.xiaohongshu.com/new/note-manager', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 4000));

  // 新版小红书创作者后台:笔记卡片是 .note-card(旧版 div.note 已随改版失效)
  const noteCards = await page.$$('.note-card');
  const results: NoteRaw[] = [];

  for (const card of noteCards) {
    if (typeof limit === 'number' && results.length >= limit) break;

    const data = await page.evaluate((el) => {
      const raw = el.getAttribute('data-impression');
      let noteId = '';
      if (raw) {
        try { noteId = (JSON.parse(raw) as any)?.noteTarget?.value?.noteId ?? ''; } catch { /* ignore */ }
      }
      const titleEl = el.querySelector('.note-card__title');
      const timeEl  = el.querySelector('.note-card__time');
      const tagEl   = el.querySelector('.note-card__tag');
      // 封面图:新版在 .note-card__media img 或 .media-bg background-image
      let coverImage = '';
      const imgEl = el.querySelector('.note-card__media img');
      if (imgEl) coverImage = imgEl.getAttribute('src') || '';
      if (!coverImage) {
        const bgEl = el.querySelector('.media-bg');
        if (bgEl) {
          const style = bgEl.getAttribute('style') || '';
          const m = style.match(/url\(["']?([^"']+)["']?\)/);
          if (m) coverImage = m[1];
        }
      }
      return {
        noteId,
        title: titleEl ? (titleEl.textContent || '').trim() : '未知标题',
        publishTime: timeEl ? (timeEl.textContent || '').trim() : '',
        tag: tagEl ? (tagEl.textContent || '').trim() : '',
        coverImage,
      };
    }, card);

    if (!data.noteId) continue;

    const cacheKey = prefixedCacheFilename(session.cachePathPrefix, `notes/${data.noteId}.json`);
    const cached = loadFromCache<NoteRaw>(cacheKey);

    const interactions = await getNewInteractions(page, card);

    let note: NoteRaw;
    if (cached) {
      note = { ...cached, ...data, ...interactions };
    } else {
      note = {
        ...data,
        url: `https://www.xiaohongshu.com/explore/${data.noteId}`,
        ...interactions,
      };
    }

    saveToCache(cacheKey, note);
    results.push(note);
  }

  if (results.length === 0) return '未找到笔记数据';
  return results.map(formatNote).join('\n\n');
}

export async function getRecentPosts(
  session: ResolvedSession,
  limit?: number,
): Promise<string> {
  return withLoggedInPage((page) => scrapeRecentPosts(page, session, limit), session.browserUserDataDir);
}
