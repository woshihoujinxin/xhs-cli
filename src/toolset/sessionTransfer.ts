// 登录态导出 / 导入：跨机器、跨操作系统迁移登录态
//
// 背景（为什么不能直接拷贝 userDataDir 目录）：
//   Chrome 的 cookie 由系统级加密保护 ——
//     Windows: DPAPI（Local State 里 os_crypt.encrypted_key 解密后以 "DPA" 开头），
//              绑当前 Windows 用户凭据
//     Linux:   v10/v11，密钥来自固定密码或 keyring
//   因此把 userDataDir 拷到另一台机器/另一个 OS，cookie 一律解不开，等于没登录。
//
// 本模块走 CDP：
//   - 导出：Network.getCookies 返回的是浏览器**已解密后的明文**，与底层加密无关
//   - 导入：Network.setCookies 注入明文，浏览器再按本机方式重新加密落盘
//   实测 16/16 小红书 cookie 均为明文可读，且导入到全新空 profile 后可正常登录。
//
// 安全：导出文件是**明文凭据**，等同账号密码。写入用 0o600，
// 并在文档与提示里反复强调：用完 shred、不要进 git、不要走 IM。

import { existsSync, readFileSync, writeFileSync, statSync, chmodSync } from 'fs';
import type { Page } from 'puppeteer-core';
import { launchBrowser } from '../browser/index.js';
import { getUserProfile } from './get_profile.js';

/** 只迁移小红书域下的 cookie，避免把无关站点的凭据一起带出去 */
const XHS_DOMAIN_RE = /xiaohongshu|xhscdn/i;

const CREATOR_HOME = 'https://creator.xiaohongshu.com/new/home';

/** 导出文件的载格式 */
export interface SessionBundle {
  /** 固定标识，导入时校验，防止误传别的 json */
  format: 'xhs-cli-session';
  version: 1;
  exportedAt: string;
  sourcePlatform: string;
  account?: string;
  cookieCount: number;
  cookies: SerializedCookie[];
}

export interface SerializedCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  expires?: number;
}

export interface TransferResult {
  ok: boolean;
  message: string;
  /** 导出时的落盘路径 */
  outPath?: string;
  cookieCount?: number;
  /** 最早过期的 cookie 信息，便于提醒用户及时刷新 */
  soonestExpiry?: { name: string; days: number };
}

/** 判断页面当前是否处于已登录状态 */
async function isLoggedIn(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes('/login') || url.includes('/signin')) return false;
  const text = await page
    .evaluate(() => (document.body?.innerText || '').slice(0, 800))
    .catch(() => '');
  return !/扫码登录|立即登录|手机号登录/.test(text);
}

async function openCreatorHome(page: Page): Promise<void> {
  await page.goto(CREATOR_HOME, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 4000));
}

/**
 * 导出当前账号的登录态到文件。
 * 注意：调用方需保证账户已登录；未登录时返回 ok:false 而非抛错，
 * 便于 CLI 给出可操作的提示（提示用户先 xhs login）。
 */
export async function exportSession(options: {
  browserUserDataDir: string;
  outPath: string;
  account?: string;
}): Promise<TransferResult> {
  const browser = await launchBrowser(true, [], options.browserUserDataDir);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    await openCreatorHome(page);
    if (!(await isLoggedIn(page))) {
      return {
        ok: false,
        message:
          '当前账号未登录，无法导出。请先在有头模式登录：\n'
          + `  xhs login${options.account ? ` --account ${options.account}` : ''}\n`
          + '（若上次是 headless 登录，可能未落盘 cookie，建议用有头模式再登一次）',
      };
    }

    const { cookies } = await client.send('Network.getCookies');
    const keep = (cookies as SerializedCookie[]).filter((c) => XHS_DOMAIN_RE.test(c.domain || ''));
    if (keep.length === 0) {
      return { ok: false, message: '未取到任何小红书 cookie，导出中止。' };
    }

    const bundle: SessionBundle = {
      format: 'xhs-cli-session',
      version: 1,
      exportedAt: new Date().toISOString(),
      sourcePlatform: process.platform,
      account: options.account,
      cookieCount: keep.length,
      cookies: keep.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        // 平台可能给空值/非法值，收敛到 Chrome 接受的枚举
        sameSite: (['Strict', 'Lax', 'None'] as const).includes(c.sameSite as 'Strict')
          ? c.sameSite
          : 'Lax',
        expires: c.expires && c.expires > 0 ? Math.floor(c.expires) : undefined,
      })),
    };

    writeFileSync(options.outPath, JSON.stringify(bundle, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });

    // 最早过期时间用于提醒刷新频率
    const nowSec = Date.now() / 1000;
    const upcoming = bundle.cookies
      .filter((c) => c.expires && c.expires > nowSec)
      .sort((a, b) => (a.expires as number) - (b.expires as number));
    const soonest = upcoming[0];
    const soonestExpiry = soonest
      ? { name: soonest.name, days: Math.ceil(((soonest.expires as number) - nowSec) / 86400) }
      : undefined;

    const hasCore = bundle.cookies.some((c) =>
      /galaxy_creator_session_id|access-token-creator/.test(c.name),
    );

    return {
      ok: true,
      outPath: options.outPath,
      cookieCount: bundle.cookies.length,
      soonestExpiry,
      message:
        `✅ 已导出 ${bundle.cookies.length} 个 cookie → ${options.outPath}\n`
        + `   含核心凭据: ${hasCore ? '有' : '无（登录态可能不完整）'}\n`
        + (soonestExpiry
          ? `   最早过期: ${soonestExpiry.name} → ${soonestExpiry.days} 天后\n`
          : '')
        + '\n⚠️ 该文件是明文登录凭据，等同账号密码：\n'
        + '   传给其他机器后立即 chmod 600，用完 shred -u 删除。',
    };
  } finally {
    await browser.close();
  }
}

/** 校验并解析导出文件 */
function readBundle(path: string): SessionBundle {
  if (!existsSync(path)) {
    throw new Error(`找不到文件: ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    throw new Error(`${path} 不是合法 JSON，请确认是本工具导出的文件。`);
  }
  const b = parsed as SessionBundle;
  if (b?.format !== 'xhs-cli-session' || !Array.isArray(b.cookies)) {
    throw new Error(
      `${path} 不是本工具导出的登录态文件（缺少 format: "xhs-cli-session" 标识）。\n`
      + '请确认：不要误传别的 json。',
    );
  }
  return b;
}

/**
 * 导入登录态到目标机器。
 * 注入后必须实际访问页面验证，不能只看 setCookies 成功 ——
 * cookie 可能已过期，或因风控绑 IP 而在新机器上失效。
 */
export async function importSession(options: {
  browserUserDataDir: string;
  inPath: string;
  account?: string;
}): Promise<TransferResult> {
  const bundle = readBundle(options.inPath);

  // 提示文件权限过宽（Unix 下）
  if (process.platform !== 'win32') {
    try {
      const mode = statSync(options.inPath).mode & 0o777;
      if (mode & 0o077) {
        chmodSync(options.inPath, 0o600);
      }
    } catch {
      /* 权限调整失败不阻断导入 */
    }
  }

  const nowSec = Date.now() / 1000;
  const valid = bundle.cookies.filter((c) => !c.expires || c.expires > nowSec);
  const expiredCount = bundle.cookies.length - valid.length;
  if (valid.length === 0) {
    return {
      ok: false,
      message:
        '文件里的 cookie 全部已过期。\n'
        + '登录态需在源机器重新导出（核心凭据有效期通常只有数天）。',
    };
  }

  const browser = await launchBrowser(true, [], options.browserUserDataDir);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    const client = await page.createCDPSession();
    await client.send('Network.enable');

    await client.send('Network.setCookies', { cookies: valid });
    await openCreatorHome(page);

    const ok = await isLoggedIn(page);
    if (!ok) {
      return {
        ok: false,
        cookieCount: valid.length,
        message:
          `已注入 ${valid.length} 个 cookie，但登录态验证失败。\n`
          + '常见原因：\n'
          + '  1. cookie 已过期（核心凭据通常仅数天有效期）→ 回源机器重新导出\n'
          + '  2. 风控 cookie（websectiga/acw_tc）绑 IP，换机器后失效\n'
          + '     → 需在该机器上重新扫码登录：xhs login\n'
          + '  3. 源机器与目标机器时区/指纹差异过大\n'
          + '\n不要在未确认的情况下反复重试导入 —— 连续失败可能触发平台风控。',
      };
    }

    // 再确认发布页可达，这才是发帖真正需要的
    let publishReachable = false;
    try {
      await page.goto('https://creator.xiaohongshu.com/publish/publish?from=homepage&target=image', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await new Promise((r) => setTimeout(r, 3000));
      publishReachable = page.url().includes('/publish/publish');
    } catch {
      publishReachable = false;
    }

    // 顺手把账号信息带回来，便于确认注入的是哪个号
    let nickname: string | undefined;
    try {
      const profile = await getUserProfile(page);
      nickname = profile?.accountName;
    } catch {
      /* 昵称取不到不影响导入结果 */
    }

    return {
      ok: true,
      cookieCount: valid.length,
      message:
        `✅ 已注入 ${valid.length} 个 cookie`
        + (expiredCount ? `（跳过 ${expiredCount} 个已过期）` : '')
        + '\n'
        + `   登录态验证: 成功\n`
        + `   发布页可达: ${publishReachable ? '是' : '否（发帖可能受限）'}\n`
        + (nickname ? `   账号: ${nickname}\n` : '')
        + `\n建议下一步：xhs recent --limit 3 确认笔记列表正常。`,
    };
  } finally {
    await browser.close();
  }
}

/** 查询当前机器上的登录态（供 status 命令复用） */
export async function checkSessionStatus(options: {
  browserUserDataDir: string;
  account?: string;
}): Promise<TransferResult> {
  const browser = await launchBrowser(true, [], options.browserUserDataDir);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await openCreatorHome(page);
    const ok = await isLoggedIn(page);

    let nickname: string | undefined;
    if (ok) {
      try {
        const profile = await getUserProfile(page);
        nickname = profile?.accountName;
      } catch {
        /* ignore */
      }
    }

    return {
      ok,
      message: ok
        ? `登录态: 已登录${nickname ? `（${nickname}）` : ''}`
        : '登录态: 未登录。请执行 xhs login，或从其他机器导入登录态。',
    };
  } finally {
    await browser.close();
  }
}
