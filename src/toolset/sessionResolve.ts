import { BROWSER_USER_DATA_DIR, ensureAppDataLayout } from '../config.js';
import {
  hasConfiguredAccounts,
  loadAccountsRegistry,
  pickAccountSlug,
} from './accountRegistry.js';
import type { ResolvedSession } from './sessionTypes.js';

/**
 * 解析本次命令使用的 Puppeteer userDataDir 与缓存前缀。
 *
 * - 未创建任何账号：使用遗留 `browser-data`，缓存无前缀。
 * - 已配置账号：`explicitAccount` 优先，否则 `currentAccount`；若二者皆空且仅有一个账号，则自动使用该 slug。
 * - 多个账号且无法确定 slug：回落遗留 `browser-data`。
 */
export function resolveSession(explicitAccount?: string): ResolvedSession {
  ensureAppDataLayout();
  const reg = loadAccountsRegistry();

  if (!hasConfiguredAccounts(reg)) {
    if (explicitAccount?.trim()) {
      throw new Error(
        '尚未配置任何多账号会话。请先执行 xhs account add <name>，或去掉 --account 使用默认 ~/.xhs-cli/.cache/browser-data 。',
      );
    }
    return {
      browserUserDataDir: BROWSER_USER_DATA_DIR,
      cachePathPrefix: '',
    };
  }

  const slug = pickAccountSlug(reg, explicitAccount) ?? null;

  if (!slug) {
    return {
      browserUserDataDir: BROWSER_USER_DATA_DIR,
      cachePathPrefix: '',
    };
  }

  const acc = reg.accounts[slug];
  if (!acc) {
    throw new Error(`未知账号: ${slug}。可用 xhs account list 查看已配置账号。`);
  }

  return {
    browserUserDataDir: acc.browserDataDir,
    cachePathPrefix: `accounts/${slug}/`,
  };
}
