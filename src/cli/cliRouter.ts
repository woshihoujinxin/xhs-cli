/**
 * CLI：子命令直接调用 toolset 中的 impl*；自然语言 Agent 由外部宿主集成。
 */
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  implLogin,
  implGetOperationData,
  implGetOperationSnapshot,
  implPosted,
  implPostedData,
  implGetNoteDetail,
  implGetNoteDetailData,
  implPost,
  implPostLongText,
  implListDrafts,
  implCleanDrafts,
  implFetchWiki,
  implFetchAcademy,
  implLint,
  takeLongTextDeferredExit,
  implOpenHome,
  resolveSession,
  exportSession,
  importSession,
  checkSessionStatus,
} from '../toolset/index.js';
import {
  formatAccountListLines,
  addStoredAccount,
  formatShowAccount,
  setCurrentAccount,
  getCurrentAccount,
} from '../toolset/accountRegistry.js';
import { resolveAccountSlug } from '../toolset/sessionResolve.js';
import { formatPublishedList, listPublished } from '../toolset/publishedRecords.js';
import {
  parseOpts,
  resolvePostPublish,
  accountFromOpts as readAccountFromOpts,
  collectImagePaths,
} from './parseArgs.js';

class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}

function die(msg: string): never {
  throw new CliError(msg);
}

function printHelp(): void {
  console.error(`xhs-cli — 小红书命令行工具（多账号 / 本地归档）

用法与说明:
  xhs help
      显示本帮助（无子命令时也会打印本说明）

  xhs version
      显示版本号（别名 -v / --version）

  # 业务命令默认使用当前账号（xhs account use）；临时切换用 --account <name>
  # recent / metrics / detail 均支持 --json 输出结构化数据
  xhs login [--account <name>]
  xhs metrics [--json] [--account <name>]
  xhs recent [--limit <n>] [--json] [--account <name>]
  xhs posted [--account <name>]
  xhs detail <noteId> [--json] [--account <name>]
  xhs post (--title <标题> (--content <正文> | --content-file <路径>))
              [--image <路径>]... [--publish | --publish=true|false] [--account <name>]

  # 长文/文章(正文自动渲染成图片,无需本地图)
  xhs longtext (--title <标题> (--content <markdown 正文> | --content-file <路径> | --md-file <markdown路径>))
              [--description <描述> | --description-file <路径>] [--publish | --publish=true|false] [--account <name>]

  # 账号（配置存 ~/.config/xhs-cli/.cache/accounts/registry.json ，每账号独立 browser-data）
  xhs account list
  xhs account add <name>
  xhs account show <name>
  xhs account use <name>
  xhs account current

  # 登录态导入/导出（跨机器、跨操作系统迁移；用于把本机登录态搬到 Linux 服务器等）
  xhs session export [--out <路径>] [--account <name>]
  xhs session import <路径> [--account <name>]
  xhs session status [--account <name>]

  # 平台草稿箱（创作者后台自动保存的草稿；删除不可恢复）
  xhs drafts list [--json] [--account <name>]
  xhs drafts clean [--type <video|image|longtext|other>]… [--yes] [--account <name>]

  # 创作百科采集（输出 markdown 到 ~/.config/xhs-cli/.cache/wiki/，可作技能引用文档）
  xhs wiki [fetch] [--out <目录>] [--json] [--account <name>]

  # 创作学院课程采集（图文全文 / 视频下载与 Whisper 转写）
  # GPU 可用时自动探测；可用 XHS_TRANSCRIBE_DEVICE=cuda|cpu 覆盖
  xhs academy [--limit <n>] [--download-only | --transcribe] [--out <目录>] [--json] [--account <name>]

  # 发帖前预检（纯本地：标题/字数/图片张数/风控词）
  xhs lint (--title <标题> (--content <正文> | --content-file <路径>)) [--image <路径>]… [--json]

数据目录见 ~/.config/xhs-cli/.cache/（详见 README 与 src/config.ts）。
备注：不会在无人确认时擅自发帖；xhs post 的 --publish 由人工按需触发。
`);
}

function printVersion(): void {
  // dist 在 node_modules/@easyasstudio/xhs-cli/dist/cli/,package.json 在上两级
  // 开发时 src/cli/,package.json 在上两级 —— 路径一致
  const candidates = [
    fileURLToPath(new URL('../../package.json', import.meta.url)),
    fileURLToPath(new URL('../../../package.json', import.meta.url)),
  ];
  let pkg: { name?: string; version?: string } = {};
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        pkg = JSON.parse(readFileSync(p, 'utf-8'));
        break;
      }
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  const name = pkg.name ?? 'xhs-cli';
  const version = pkg.version ?? 'unknown';
  console.log(`${name} ${version}`);
}

function resolveSessionCli(explicitAccount?: string) {
  try {
    const slug = explicitAccount?.trim();
    return resolveSession(slug || undefined);
  } catch (e) {
    die(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 仅读取 `--account`；未指定时由 resolveSession 使用 registry 当前账号。 */
function accountFromOpts(opts: Record<string, string>): string | undefined {
  if (opts.account !== undefined && !opts.account.trim()) {
    die('❌ --account 需要非空账号名');
  }
  return readAccountFromOpts(opts);
}

/** 平台草稿箱：list / clean */
async function runDraftsCommand(tail: string[]): Promise<void> {
  const sub = tail[0]?.toLowerCase()?.trim() || 'list';
  const rest = tail.slice(sub === 'list' || sub === 'clean' ? 1 : 0);
  if (sub !== 'list' && sub !== 'clean') {
    die('❌ 用法: drafts list [--json] | drafts clean [--type <video|image|longtext|other>]… [--yes]');
  }
  const { opts, flags, rest: positional } = parseOpts(rest);
  if (positional.length > 0) {
    die(`❌ 多余参数: ${positional.join(' ')}`);
  }

  // clean 的参数校验先于账号解析(纯参数检查,不依赖环境)
  let types: string[] | undefined;
  if (sub === 'clean') {
    if (opts.type !== undefined) {
      const valid = new Set(['video', 'image', 'longtext', 'other']);
      types = opts.type.split(',').map((s) => s.trim()).filter(Boolean);
      const bad = types.filter((t) => !valid.has(t));
      if (bad.length > 0) {
        die(`❌ --type 不支持: ${bad.join(',')}（可选 video,image,longtext,other）`);
      }
    }
    if (!flags.has('yes')) {
      die([
        '❌ 清理平台草稿不可恢复。请先 `xhs drafts list` 确认内容，',
        '再执行 `xhs drafts clean [--type <…>] --yes`。',
      ].join('\n'));
    }
  }

  const session = resolveSessionCli(accountFromOpts(opts));

  if (sub === 'list') {
    const snap = await implListDrafts(session);
    if (flags.has('json')) {
      console.log(JSON.stringify(snap, null, 2));
      return;
    }
    console.log(`草稿箱共 ${snap.total} 篇`);
    for (const g of snap.groups) {
      console.log(`\n【${g.label}】${g.items.length} 篇`);
      for (const it of g.items.slice(0, 50)) {
        const title = it.title.replace(/\s+/g, ' ').slice(0, 40) || '(无标题)';
        console.log(`  · ${title}  ${it.time}`);
      }
      if (g.items.length > 50) {
        console.log(`  … 其余 ${g.items.length - 50} 篇省略`);
      }
    }
    return;
  }

  // clean
  const res = await implCleanDrafts(session, {
    types,
    onProgress: (m) => console.error(m),
  });
  const perType = res.perType
    .filter((p) => p.deleted > 0)
    .map((p) => `${p.type}:${p.deleted}`)
    .join('  ');
  console.log(`✅ 已删除 ${res.deleted} 篇草稿${perType ? `（${perType}）` : ''}，剩余 ${res.remaining} 篇`);
}

function runAccountCommand(tail: string[]): void {  const sub = tail[0]?.toLowerCase()?.trim();
  const rest = tail.slice(1);
  if (!sub || sub === 'help' || sub === '--help') {
    die(`❌ 用法: account list | add <name> | show <name> | use <name> | current`);
    return;
  }
  try {
    if (sub === 'use') {
      const name = rest[0]?.trim();
      if (!name) {
        die('❌ 用法: account use <name>');
      }
      setCurrentAccount(name);
      console.log(`✅ 当前账号: ${name}`);
      return;
    }
    if (sub === 'current') {
      try {
        const slug = resolveAccountSlug();
        console.log(slug);
      } catch (e) {
        die(`❌ ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    if (sub === 'list') {
      console.log(formatAccountListLines());
      return;
    }
    if (sub === 'show') {
      const name = rest[0]?.trim();
      if (!name) {
        die('❌ 用法: account show <name>');
      }
      console.log(formatShowAccount(name));
      return;
    }
    if (sub === 'add') {
      const name = rest[0]?.trim();
      if (!name) {
        die('❌ 用法: account add <name>');
      }
      addStoredAccount({ name });
      const cur = getCurrentAccount();
      console.log(
        cur === name
          ? `✅ 已添加账号: ${name}（已设为当前账号）`
          : `✅ 已添加账号: ${name}`,
      );
      return;
    }
  } catch (e) {
    die(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
  die(`❌ 未知 account 子命令: ${sub}`);
}

/**
 * 登录态导入 / 导出。用于把本机登录态迁移到另一台机器（例如搬去 Linux 服务器）。
 *
 * 为什么需要它：Chrome cookie 由系统级加密保护（Windows 用 DPAPI）。
 * 直接拷贝 userDataDir 到别的机器/OS 会解不开，等于没登录。
 * 本命令走 CDP 导出已解密的明文，再在目标机注入。
 */
async function runSessionCommand(tail: string[]): Promise<void> {
  const sub = tail[0]?.toLowerCase()?.trim();
  const { opts, rest } = parseOpts(tail.slice(1));
  try {
    if (!sub || sub === 'help' || sub === '--help') {
      die(
        '用法:\n'
        + '  session export [--out <路径>]   导出当前登录态（默认 ./session.json）\n'
        + '  session import <路径>           导入登录态到本机\n'
        + '  session status                  查看本机登录态\n'
        + '\n通用选项: [--account <name>]\n'
        + '⚠️ 导出文件是明文凭据，等同账号密码 —— chmod 600，用完 shred -u。',
      );
      return;
    }

    const session = resolveSessionCli(accountFromOpts(opts));

    if (sub === 'status') {
      const r = await checkSessionStatus({
        browserUserDataDir: session.browserUserDataDir,
        account: session.account,
      });
      console.log((r.ok ? '✅ ' : '❌ ') + r.message);
      if (!r.ok) process.exitCode = 1;
      return;
    }

    if (sub === 'export') {
      const outPath = (opts.out || opts.o || 'session.json').trim();
      const r = await exportSession({
        browserUserDataDir: session.browserUserDataDir,
        outPath,
        account: session.account,
      });
      console.log((r.ok ? '' : '❌ ') + r.message);
      if (!r.ok) process.exitCode = 1;
      return;
    }

    if (sub === 'import') {
      const inPath = rest[0]?.trim() || opts.in?.trim();
      if (!inPath) {
        die('用法: session import <路径>');
      }
      const r = await importSession({
        browserUserDataDir: session.browserUserDataDir,
        inPath,
        account: session.account,
      });
      console.log((r.ok ? '' : '❌ ') + r.message);
      if (!r.ok) process.exitCode = 1;
      return;
    }

    die(`未知 session 子命令: ${sub}`);
  } catch (e) {
    die(`❌ ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * 执行一条子命令（与传入 `process.argv` 切片语义一致，不含 `xhs` 本身）。
 */
export async function runOneCommand(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    return;
  }

  const cmd = argv[0];
  const tail = argv.slice(1);

  if (cmd === 'account') {
    runAccountCommand(tail);
    return;
  }
  if (cmd === 'session') {
    await runSessionCommand(tail);
    return;
  }
  if (cmd === 'drafts' || cmd === 'draft') {
    return runDraftsCommand(tail);
  }

  if (cmd === 'published') {
    die('❌ published 已移除，请使用：xhs posted [--account <name>]');
  }

  if (cmd === 'login') {
    const { opts, rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: login [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    const msg = await implLogin(session);
    if (msg.startsWith('✅')) {
      setCurrentAccount(session.account);
    }
    console.log(msg);
    return;
  }
  if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
    const { rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: version(无参数)');
    }
    printVersion();
    return;
  }
  if (cmd === 'home' || cmd === 'open') {
    const { opts, rest } = parseOpts(tail);
    const pageName = rest[0]?.trim() || 'home';
    const validPages = ['home', 'note-manager', 'note', 'content', 'fans', 'profile'];
    if (rest.length > 1 || (rest.length === 1 && !validPages.includes(pageName))) {
      die('❌ 用法: home [home|note-manager|content|fans|profile] [--account <name>]');
    }
    await implOpenHome(resolveSessionCli(accountFromOpts(opts)), pageName);
    return;
  }
  if (cmd === 'metrics') {
    const { opts, rest, flags } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: metrics [--json] [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    if (flags.has('json')) {
      console.log(JSON.stringify(await implGetOperationSnapshot(session), null, 2));
    } else {
      console.log(await implGetOperationData(session));
    }
    return;
  }

  if (cmd === 'posted') {
    const { opts, rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: posted [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    console.log(formatPublishedList(listPublished(session.account)));
    return;
  }

  if (cmd === 'recent') {
    const { opts, rest, flags } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: recent [--limit <n>] [--json] [--account <name>]');
    }
    const lim = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
    if (opts.limit !== undefined && (Number.isNaN(lim!) || lim! < 1)) {
      die('❌ --limit 需为正整数');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    if (flags.has('json')) {
      console.log(JSON.stringify(await implPostedData(lim, session), null, 2));
    } else {
      console.log(await implPosted(lim, session));
    }
    return;
  }

  if (cmd === 'detail' || cmd === 'note-detail') {
    const { opts, rest, flags } = parseOpts(tail);
    const id = rest[0]?.trim();
    if (!id || rest.length > 1) {
      die('❌ 用法: detail <noteId> [--json] [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    if (flags.has('json')) {
      const data = await implGetNoteDetailData(id, session);
      if (!data) {
        die(`未找到笔记详情: ${id}`);
      }
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(await implGetNoteDetail(id, session));
    }
    return;
  }

  if (cmd === 'post') {
    const { opts, flags, rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: post --title <标题> (--content | --content-file) --image <路径> … [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    const title = opts.title?.trim();
    if (!title) {
      die('❌ post 需要 --title <标题>');
    }
    let content = opts.content ?? '';
    if (opts['content-file']) {
      const p = opts['content-file'];
      if (!existsSync(p)) {
        die(`❌ 找不到文件: ${p}`);
      }
      content = readFileSync(p, 'utf-8');
    }
    if (!content.trim()) {
      die('❌ 请提供 --content 或 --content-file');
    }
    const imagePaths = collectImagePaths(tail);
    if (imagePaths.length === 0) {
      die('❌ 至少需要一张图片: 重复 --image <本地路径>（1～18 张）');
    }
    console.log(
      await implPost({
        title,
        content,
        imagePaths,
        publish: resolvePostPublish(opts, flags),
        browserUserDataDir: session.browserUserDataDir,
      }),
    );
    return;
  }

  if (cmd === 'longtext' || cmd === 'post-longtext') {
    const { opts, flags, rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: longtext --title <标题> (--content <正文> | --content-file <路径> | --md-file <markdown路径>) [--description <描述> | --description-file <路径>] [--publish] [--account <name>]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    const title = opts.title?.trim();
    if (!title) {
      die('❌ longtext 需要 --title <标题>');
    }
    // --md-file 优先：走编辑器「从文件导入」流程（小红书按 markdown 结构渲染）
    const mdFile = opts['md-file']?.trim();
    let content = opts.content ?? '';
    if (opts['content-file']) {
      const p = opts['content-file'];
      if (!existsSync(p)) {
        die(`❌ 找不到文件: ${p}`);
      }
      content = readFileSync(p, 'utf-8');
    }
    if (!mdFile && !content.trim()) {
      die('❌ 请提供 --content、--content-file 或 --md-file');
    }
    if (mdFile && !existsSync(mdFile)) {
      die(`❌ 找不到 markdown 文件: ${mdFile}`);
    }
    // --description / --description-file: 进入常规发布页后在正文区填的关键词/描述
    let description = opts.description ?? '';
    if (opts['description-file']) {
      const p = opts['description-file'];
      if (!existsSync(p)) {
        die(`❌ 找不到描述文件: ${p}`);
      }
      description = readFileSync(p, 'utf-8');
    }
    console.log(
      await implPostLongText({
        title,
        content,
        mdFile: mdFile || undefined,
        description: description.trim() || undefined,
        publish: resolvePostPublish(opts, flags),
        browserUserDataDir: session.browserUserDataDir,
      }),
    );
    // 发布后自动验证接管了退出时机（绕过 postLongText 内部的 process.exit）
    if (takeLongTextDeferredExit()) {
      process.exit(0);
    }
    return;
  }

  if (cmd === 'wiki' || cmd === 'encyclopedia') {
    // 创作百科采集:输出 markdown 到 .cache/wiki/(可作为技能引用文档)
    const { opts, flags, rest } = parseOpts(tail);
    if (rest.length > 0) {
      die('❌ 用法: wiki [fetch] [--out <目录>] [--json] [--account <name>]');
    }
    const sub = tail[0]?.toLowerCase();
    if (sub !== undefined && sub !== 'fetch') {
      die('❌ 用法: wiki [fetch] [--out <目录>] [--json]');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    const res = await implFetchWiki(session, {
      outDir: opts.out?.trim() || undefined,
      onProgress: (m) => console.error(m),
    });
    if (flags.has('json')) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`\n✅ 已采集 ${res.files.length}/6 个分类，共 ${res.totalChars} 字`);
      console.log(`输出目录: ${res.outDir}`);
      for (const f of res.files) {
        console.log(`  · ${f.category}.md  (${f.sections} 章节 / ${f.questions} 问题)`);
      }
      if (res.errors.length > 0) {
        console.log(`⚠️ ${res.errors.length} 个分类采集失败，可重试`);
      }
    }
    return;
  }

  if (cmd === 'lint') {
    // 发帖前预检:纯本地校验(结构规则+风控词),不访问网络
    const { opts, flags } = parseOpts(tail);
    let content = opts.content ?? '';
    if (opts['content-file']) {
      const p = opts['content-file'];
      if (!existsSync(p)) {
        die(`❌ 找不到文件: ${p}`);
      }
      content = readFileSync(p, 'utf-8');
    }
    const imagePaths = collectImagePaths(tail);
    const res = implLint({
      title: opts.title,
      content,
      imageCount: imagePaths.length > 0 ? imagePaths.length : undefined,
    });
    if (flags.has('json')) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      for (const i of res.issues) {
        const mark = i.level === 'error' ? '❌' : '⚠️ ';
        console.log(`${mark} [${i.code}] ${i.message}`);
      }
      console.log(res.ok ? '\n✅ 预检通过（注意 ⚠️ 项为建议）' : '\n❌ 存在必须修复的问题');
    }
    if (!res.ok) {
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === 'academy') {
    // 创作学院课程采集(图文全文/视频简介)
    const { opts, flags } = parseOpts(tail);
    if (opts.limit !== undefined && !/^\d+$/.test(opts.limit)) {
      die('❌ --limit 需为正整数');
    }
    const session = resolveSessionCli(accountFromOpts(opts));
    const res = await implFetchAcademy(session, {
      outDir: opts.out?.trim() || undefined,
      maxCourses: opts.limit ? parseInt(opts.limit, 10) : undefined,
      transcribe: flags.has('transcribe'),
      downloadOnly: flags.has('download-only'),
      onProgress: (m) => console.error(m),
    });
    const videos = res.courses.filter((c) => c.type === '视频').length;
    if (flags.has('json')) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      const s = res.summary;
      console.log(`\n✅ 已采集 ${res.courses.length} 门课程（图文 ${res.inventory.image} / 视频 ${videos}）`);
      console.log(`⬇️ 下载：目标 ${s.download.total}，已有 ${s.download.existing}，新增 ${s.download.downloaded}，失败 ${s.download.failed}，媒体地址缺失 ${s.mediaMissing}`);
      console.log(`🎧 转写：目标 ${s.transcription.targeted}，成功 ${s.transcription.succeeded}，失败 ${s.transcription.failed}，未下载 ${s.transcription.notDownloaded}`);
      console.log(`⚠️ 失败课程 ${s.failedCourses}，错误明细 ${s.errorCount}`);
      console.log(`索引文件: ${res.outDir}/academy-index.json`);
      for (const f of res.files) {
        console.log(`  · ${f}`);
      }
    }
    if ((flags.has('download-only') || flags.has('transcribe')) && res.summary.failedCourses > 0) {
      process.exitCode = 1;
    }
    return;
  }

  die(`❌ 未知命令 “${cmd}”。请使用 xhs help 查看用法。`);
}

function handleCliError(e: unknown): void {
  if (e instanceof CliError) {
    console.error(e.message);
    process.exit(1);
  }
  throw e;
}

export async function runCli(argv: string[]): Promise<void> {
  if (argv.length === 0) {
    console.error('❌ 请提供子命令，例如 xhs help、xhs login …\n');
    printHelp();
    process.exit(1);
  }

  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    printHelp();
    return;
  }

  try {
    await runOneCommand(argv);
  } catch (e) {
    handleCliError(e);
  }
}
