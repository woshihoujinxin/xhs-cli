/**
 * 小红书等业务能力（impl*）；供 CLI 子命令直接调用；外部 Agent 可单独引用同一套 impl。
 */
import { login } from './login.js';
import { getOperationData, getOperationSnapshot, type OperationDataSnapshot } from './get_metrics.js';
import { getNoteDetail, getNoteDetailData, type NoteDetailData } from './get_note_detail.js';
import { formatUserProfileText } from './get_profile.js';
import { getRecentPosts, getRecentPostsData, type RecentPostsResult } from './get_recent_posts.js';
import { postNote, type PostNoteArgs } from './post.js';
import { postLongText, type PostLongTextArgs } from './postLongText.js';
import { openHome } from './open_home.js';
import { verifyPublished } from './publishVerify.js';
import {
  listPlatformDrafts,
  cleanPlatformDrafts,
  type DraftsSnapshot,
  type CleanResult,
} from './drafts.js';
import { fetchEncyclopedia, type WikiFetchResult } from './wiki.js';
import { fetchAcademy, type AcademyResult } from './academy.js';
import { lintContent, type LintResult } from './lint.js';
import { resolveAccountSlug, resolveSession } from './sessionResolve.js';
import type { ResolvedSession } from './sessionTypes.js';

function sessionOrDefault(session?: ResolvedSession): ResolvedSession {
  if (session) {
    return session;
  }
  return resolveSession();
}

/** 发布成功后追加自动验证结论（仅 --publish 时） */
async function appendVerifySuffix(args: { publish?: boolean; title?: string; browserUserDataDir?: string }): Promise<string> {
  if (!args.publish || !args.title?.trim()) {
    return '';
  }
  try {
    const v = await verifyPublished({ browserUserDataDir: args.browserUserDataDir, title: args.title });
    if (v.verified) {
      return `\n✅ 已在新笔记列表确认发布（${v.noteId ?? 'id 待列表同步'}）`;
    }
    return '\n⚠️ 暂未在笔记列表看到新笔记（可能平台延迟）。请稍后用 xhs recent 确认，未知结果前勿立即重发。';
  } catch {
    return '\n⚠️ 自动验证未完成（页面/网络异常），请手动 xhs recent 确认。';
  }
}

export async function implLogin(session?: ResolvedSession): Promise<string> {
  const s = sessionOrDefault(session);
  const userProfile = await login(s.browserUserDataDir);
  if (userProfile) {
    return `✅ 登录成功\n${formatUserProfileText(userProfile)}`;
  }
  return '❌ 登录失败';
}

export async function implGetOperationData(session?: ResolvedSession): Promise<string> {
  const s = sessionOrDefault(session);
  return getOperationData(s);
}

export async function implGetOperationSnapshot(session?: ResolvedSession): Promise<OperationDataSnapshot> {
  const s = sessionOrDefault(session);
  return getOperationSnapshot(s);
}

export async function implPosted(
  limit: number | undefined,
  session?: ResolvedSession,
): Promise<string> {
  const s = sessionOrDefault(session);
  return getRecentPosts(s, limit);
}

export async function implPostedData(
  limit: number | undefined,
  session?: ResolvedSession,
): Promise<RecentPostsResult> {
  const s = sessionOrDefault(session);
  return getRecentPostsData(s, limit);
}

export async function implGetNoteDetail(
  noteId: string,
  session?: ResolvedSession,
): Promise<string> {
  const s = sessionOrDefault(session);
  return getNoteDetail(noteId, s);
}

export async function implGetNoteDetailData(
  noteId: string,
  session?: ResolvedSession,
): Promise<NoteDetailData | null> {
  const s = sessionOrDefault(session);
  return getNoteDetailData(noteId, s);
}

export async function implPost(args: PostNoteArgs): Promise<string> {
  try {
    const result = await postNote(args);
    if (!result.success) {
      return `❌ ${result.message}`;
    }
    const suffix = await appendVerifySuffix({
      publish: args.publish,
      title: args.title,
      browserUserDataDir: args.browserUserDataDir,
    });
    return `✅ ${result.message}${suffix}`;
  } catch (e) {
    return `❌ ${e instanceof Error ? e.message : String(e)}`;
  }
}

// implPostLongText 因发布后验证而接管了 postLongText 的退出时机时置位；
// CLI 层打印结果后调用 takeLongTextDeferredExit() 决定是否 process.exit。
let longTextDeferredExit = false;

export function takeLongTextDeferredExit(): boolean {
  const v = longTextDeferredExit;
  longTextDeferredExit = false;
  return v;
}

export async function implPostLongText(args: PostLongTextArgs): Promise<string> {
  // postLongText 成功路径会在 finally 里 process.exit(0)，发布后验证必须在其之前完成：
  // 需要验证时临时启用 XHS_LONGTEXT_NO_EXIT，验证结束后恢复环境并交由 CLI 层退出。
  const prevNoExit = process.env.XHS_LONGTEXT_NO_EXIT;
  const needVerify = !!args.publish && !!args.title?.trim();
  const deferExit = needVerify && prevNoExit !== '1';
  if (deferExit) {
    process.env.XHS_LONGTEXT_NO_EXIT = '1';
  }
  try {
    const result = await postLongText(args);
    if (!result.success) {
      return `❌ ${result.message}`;
    }
    const suffix = await appendVerifySuffix({
      publish: args.publish,
      title: args.title,
      browserUserDataDir: args.browserUserDataDir,
    });
    return `✅ ${result.message}${suffix}`;
  } catch (e) {
    return `❌ ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    if (deferExit) {
      longTextDeferredExit = true;
      if (prevNoExit === undefined) {
        delete process.env.XHS_LONGTEXT_NO_EXIT;
      } else {
        process.env.XHS_LONGTEXT_NO_EXIT = prevNoExit;
      }
    }
  }
}

export async function implOpenHome(session: ResolvedSession, pageName?: string): Promise<void> {
  return openHome(session, pageName);
}

export async function implListDrafts(session?: ResolvedSession): Promise<DraftsSnapshot> {
  const s = sessionOrDefault(session);
  return listPlatformDrafts(s.browserUserDataDir);
}

export async function implCleanDrafts(
  session?: ResolvedSession,
  opts: { types?: string[]; maxDelete?: number; onProgress?: (msg: string) => void } = {},
): Promise<CleanResult> {
  const s = sessionOrDefault(session);
  return cleanPlatformDrafts(s.browserUserDataDir, opts);
}

export async function implFetchWiki(
  session?: ResolvedSession,
  opts: { outDir?: string; onProgress?: (msg: string) => void } = {},
): Promise<WikiFetchResult> {
  const s = sessionOrDefault(session);
  return fetchEncyclopedia(s.browserUserDataDir, opts);
}

export function implLint(input: { title?: string; content?: string; imageCount?: number }): LintResult {
  return lintContent(input);
}

export async function implFetchAcademy(
  session?: ResolvedSession,
  opts: { outDir?: string; onProgress?: (m: string) => void; maxCourses?: number; transcribe?: boolean; downloadOnly?: boolean } = {},
): Promise<AcademyResult> {
  const s = sessionOrDefault(session);
  return fetchAcademy(s.browserUserDataDir, opts);
}

export { resolveAccountSlug, resolveSession };
export { setCurrentAccount, getCurrentAccount } from './accountRegistry.js';
export type { ResolvedSession };
