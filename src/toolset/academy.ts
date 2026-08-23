// 创作学院采集(creator.xiaohongshu.com/new/college)
//
// 页面结构(2026-08 实测):
//   - 两个板块:官方课程 / 创作指导(子类:数据解读指南·违规指引),各自带 .d-pagination 分页(1~5页)
//   - 课程=站内笔记链接(explore/<noteId>?xsec_token=...)
//   - 图文课→正文全文;视频课→下载签名mp4→faster-whisper转写,逐字稿单独成档(一课一文件)
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { launchBrowser } from '../browser/index.js';
import { ensureAppDataLayout, WIKI_DIR } from '../config.js';
import type { Page } from 'puppeteer-core';

const COLLEGE_URL = 'https://creator.xiaohongshu.com/new/college';

export interface AcademyCourse {
  category: string;
  title: string;
  url: string;
  noteId: string;
  type: '图文' | '视频' | '未知';
  contentChars: number;
  downloadStatus?: 'pending' | 'missing-media' | 'downloaded' | 'existing' | 'failed';
  downloadError?: string;
  transcriptionError?: string;
  transcribed?: boolean;
}
export interface AcademySummary {
  detailFailed: number;
  mediaMissing: number;
  download: DownloadSummary;
  transcription: { targeted: number; succeeded: number; failed: number; notDownloaded: number };
  failedCourses: number;
  errorCount: number;
}

export interface AcademyResult {
  outDir: string;
  fetchedAt: string;
  inventory: { total: number; image: number; video: number };
  summary: AcademySummary;
  errors: string[];
  courses: AcademyCourse[];
  files: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const safeName = (s: string) => s.replace(/[\\/:*?"<>|#]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

/* ---------------- 列表采集(含分页) ---------------- */

interface ListItem { category: string; title: string; href: string }

/** 收集当前视口内可见的课程链接(最近标题=分类) */
async function collectVisibleLinks(page: Page): Promise<ListItem[]> {
  return await page.evaluate(() => {
    const out: Array<{ category: string; title: string; href: string }> = [];
    let category = '';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as Element;
    while ((node = walker.nextNode() as Element)) {
      const tag = node.tagName.toLowerCase();
      if (/^h[1-4]$/.test(tag)) {
        const t = ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 20) category = t;
        continue;
      }
      if (tag !== 'a') continue;
      const href = node.getAttribute('href') || '';
      const title = ((node as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
      if (!href.includes('/explore/') || !title || title.length < 4) continue;
      out.push({ category, title, href: href.startsWith('http') ? href : `https://www.xiaohongshu.com${href}` });
    }
    return out;
  });
}

/** 点击第 widgetIdx 个分页组件的指定页码 */
async function clickPaginationPage(page: Page, widgetIdx: number, num: number): Promise<boolean> {
  return await page.evaluate((args) => {
    const widgets = document.querySelectorAll('.d-pagination');
    const wd = widgets[args.widgetIdx];
    if (!wd) return false;
    for (const b of Array.from(wd.querySelectorAll('.d-pagination-page')) as HTMLElement[]) {
          if ((b.innerText || '').trim().split('\n')[0] === String(args.num)) {
        (b as HTMLElement).scrollIntoView({ block: 'center' });
        b.click();
        return true;
      }
    }
    return false;
  }, { widgetIdx, num });
}

/** 全量采集:每个板块(分页组件)独立翻页,按 noteId 全局去重 */
async function scrapeAllCourses(page: Page, log: (m: string) => void): Promise<ListItem[]> {
  await page.goto(COLLEGE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(5000);

  const widgets: number[][] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.d-pagination')).map((w) =>
      Array.from(w.querySelectorAll('.d-pagination-page'))
        .map((b) => parseInt(((b as HTMLElement).innerText || '').trim().split('\n')[0], 10))
        .filter((n) => Number.isFinite(n)),
    ),
  );
  log(`分页组件 ${widgets.length} 个，页码分布: ${JSON.stringify(widgets)}`);

  const result: ListItem[] = [];
  for (let w = 0; w < widgets.length; w++) {
    const seen = new Set<string>();
    const grab = async () => {
      for (const it of await collectVisibleLinks(page)) {
        if (!seen.has(it.href)) {
          seen.add(it.href);
          result.push(it);
        }
      }
    };
    // 当前页(即该板块第1页)
    await grab();
    for (const num of widgets[w]) {
      if (num === 1) continue;
      const ok = await clickPaginationPage(page, w, num);
      if (!ok) continue;
      await sleep(2500);
      await grab();
    }
    log(`  板块${w + 1}: ${seen.size} 门`);
  }
  const unique = new Map<string, ListItem>();
  for (const item of result) {
    const noteId = item.href.match(/explore\/([a-f0-9]+)/)?.[1];
    const key = noteId || item.href;
    if (!unique.has(key)) unique.set(key, item);
  }
  log(`  全局去重后: ${unique.size} 门`);
  return [...unique.values()];
}

/* ---------------- 单课详情 ---------------- */

async function fetchNote(page: Page, url: string): Promise<{ title: string; desc: string; hasVideo: boolean; mediaUrl?: string }> {
  // 视频真实 mp4 地址通过监听网络请求捕获(带签名,页面状态里拿不到)
  const mediaUrls: string[] = [];
  const onReq = (r: { url(): string }) => {
    const u = r.url();
    if (/sns-video[^?#]*\.mp4/.test(u) && !mediaUrls.includes(u)) mediaUrls.push(u);
  };
  page.on('request', onReq);
  let desc = '', title = '', hasVideo = false;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(4000);
    // 兜底1:部分页面需"播放"才发起 mp4 请求 → 静音触发播放
    if (mediaUrls.length === 0) {
      await page.evaluate(() => {
        const v = document.querySelector('video') as HTMLVideoElement | null;
        if (v) { v.muted = true; v.play?.().catch(() => {}); }
      });
      await sleep(3500);
    }
    // 兜底2:读取视频元素及性能资源，避免序列化页面框架的巨大状态树
    if (mediaUrls.length === 0) {
      const found = await page.evaluate(() => {
        const candidates = [
          ...Array.from(document.querySelectorAll('video')).flatMap((v) => [v.currentSrc, v.src]),
          ...performance.getEntriesByType('resource').map((e) => e.name),
        ];
        return candidates.find((u) => /sns-video[^?#]*\.mp4/.test(u)) || '';
      });
      if (found && !found.startsWith('blob:')) mediaUrls.push(found);
    }
    const d = await page.evaluate(() => ({
      title: document.querySelector('#detail-title, .title')?.textContent?.trim() || '',
      desc: ((document.querySelector('#detail-desc, .desc') as HTMLElement | null)?.innerText || '').trim(),
      hasVideo: !!document.querySelector('video'),
    }));
    title = d.title; desc = d.desc; hasVideo = d.hasVideo;
  } finally {
    page.off('request', onReq);
  }
  return { title, desc, hasVideo, mediaUrl: mediaUrls.sort((a, b) => b.length - a.length)[0] || '' };
}

/* ---------------- 视频下载与转写 ---------------- */

export interface DownloadSummary {
  total: number;
  existing: number;
  downloaded: number;
  failed: number;
}

/** 并发下载视频到本地(已存在且大于10KB则跳过) */
export async function downloadVideos(
  targets: Array<{ noteId: string; title: string; mediaUrl: string; course?: AcademyCourse }>,
  videoDir: string,
  log: (m: string) => void,
  concurrency = 3,
): Promise<DownloadSummary> {
  mkdirSync(videoDir, { recursive: true });
  const manifestPath = join(videoDir, 'manifest.json');
  const manifest: { downloaded: string[]; failed: string[] } = { downloaded: [], failed: [] };
  try { Object.assign(manifest, JSON.parse(readFileSync(manifestPath, 'utf-8'))); } catch { /* 首次无账本 */ }
  const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  let existing = 0;
  let downloaded = 0;
  let failed = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const t = targets[idx++];
      const fp = join(videoDir, `${t.noteId}.mp4`);
      if (existsSync(fp)) {
        const { statSync } = await import('fs');
        if (statSync(fp).size > 10000) { existing++; t.course && (t.course.downloadStatus = 'existing'); continue; }
      }
      try {
        const res = await fetch(t.mediaUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.xiaohongshu.com/' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 10000) throw new Error(`文件过小(${buf.length}B)`);
        writeFileSync(fp, buf);
        downloaded++;
        t.course && (t.course.downloadStatus = 'downloaded');
        if (!manifest.downloaded.includes(t.noteId)) manifest.downloaded.push(t.noteId);
        saveManifest();
        log(`⬇️ [${existing + downloaded}/${targets.length}] ${t.title}`);
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        t.course && ((t.course.downloadStatus = 'failed'), (t.course.downloadError = msg));
        if (!manifest.failed.includes(t.noteId)) manifest.failed.push(t.noteId);
        saveManifest();
        log(`⚠️ 下载失败 ${t.title}: ${msg}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return { total: targets.length, existing, downloaded, failed };
}

export interface TranscribeConfig {
  device: 'auto' | 'cuda' | 'cpu';
  computeType: string;
  concurrency: number;
}

export function resolveTranscribeConfig(env: NodeJS.ProcessEnv = process.env): TranscribeConfig {
  const rawDevice = (env.XHS_TRANSCRIBE_DEVICE ?? 'auto').trim().toLowerCase();
  if (!['auto', 'cuda', 'cpu'].includes(rawDevice)) throw new Error('XHS_TRANSCRIBE_DEVICE 只能是 auto、cuda 或 cpu');
  const device = rawDevice as TranscribeConfig['device'];
  const computeType = (env.XHS_TRANSCRIBE_COMPUTE_TYPE ?? (device === 'cpu' ? 'int8' : 'int8_float32')).trim();
  if (!/^[a-z0-9_]+$/i.test(computeType)) throw new Error('XHS_TRANSCRIBE_COMPUTE_TYPE 格式无效');
  const defaultConcurrency = device === 'cpu' ? 2 : 1;
  const rawConcurrency = env.XHS_TRANSCRIBE_CONCURRENCY?.trim();
  const concurrency = rawConcurrency === undefined ? defaultConcurrency : Number(rawConcurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('XHS_TRANSCRIBE_CONCURRENCY 需为 1 到 8 的整数');
  }
  if (device === 'cuda' && concurrency > 1) throw new Error('CUDA 模式建议并发为 1，避免显存不足');
  return { device, computeType, concurrency };
}

/** 对本地 mp4 抽音频并转写 */
export async function transcribeLocalVideo(mp4Path: string, workDir: string, config = resolveTranscribeConfig()): Promise<string> {
  const path = await import('path');
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const run = promisify(execFile);
  mkdirSync(workDir, { recursive: true });
  const base = path.basename(mp4Path).replace(/\.mp4$/i, '');
  const wav = path.join(workDir, `${base}.wav`);
  if (!existsSync(wav) || (await import('fs')).statSync(wav).size === 0) {
    try {
      await run('ffmpeg', ['-y', '-i', mp4Path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    } catch (e) {
      throw new Error(`音频抽取失败，请确认已安装 ffmpeg: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (!existsSync(wav) || (await import('fs')).statSync(wav).size === 0) throw new Error('ffmpeg 未生成有效 WAV 文件');

  const py = path.join(workDir, `xhs_transcribe_${base}.py`);
  writeFileSync(py, [
    'import sys, json',
    "sys.stdout.reconfigure(encoding='utf-8')",
    'try:',
    "    from faster_whisper import WhisperModel",
    'except ImportError as e:',
    "    raise SystemExit('缺少 faster-whisper，请先安装: pip install faster-whisper') from e",
    "requested_device = sys.argv[2]",
    "compute_type = sys.argv[3]",
    "device = requested_device",
    "if requested_device == 'auto':",
    "    try:",
    "        WhisperModel('small', device='cuda', compute_type=compute_type)",
    "        device = 'cuda'",
    "    except Exception:",
    "        device = 'cpu'",
    "        compute_type = 'int8'",
    "m = WhisperModel('small', device=device, compute_type=compute_type)",
    "segs, _ = m.transcribe(sys.argv[1], language='zh', vad_filter=True)",
    "print(json.dumps({'text': ''.join(s.text for s in segs)}, ensure_ascii=False))",
  ].join('\n'), 'utf-8');
  let stdout: string;
  try {
    ({ stdout } = await run('python', [py, wav, config.device, config.computeType], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }));
  } catch (e) {
    throw new Error(`Whisper 转写失败，请确认已安装 Python/faster-whisper: ${e instanceof Error ? e.message : e}`);
  }
  return ((JSON.parse(stdout.trim().split('\n').pop() || '{}').text as string) || '').trim();
}
/* ---------------- 主流程 ---------------- */

export async function fetchAcademy(
  browserUserDataDir: string | undefined,
  opts: { outDir?: string; onProgress?: (m: string) => void; maxCourses?: number; transcribe?: boolean; downloadOnly?: boolean } = {},
): Promise<AcademyResult> {
  ensureAppDataLayout();
  const outDir = resolve(opts.outDir ?? WIKI_DIR);
  const log = opts.onProgress ?? (() => {});
  const fetchedAt = new Date().toISOString();
  const errors: string[] = [];
  let detailFailed = 0;
  let mediaMissing = 0;
  const courses: AcademyCourse[] = [];
  const download: DownloadSummary = { total: 0, existing: 0, downloaded: 0, failed: 0 };
  const transcription = { targeted: 0, succeeded: 0, failed: 0, notDownloaded: 0 };
  const browser = await launchBrowser(true, [], browserUserDataDir);

  try {
    const page = await browser.newPage();

    // Phase1: 分页全量列表
    const list = await scrapeAllCourses(page, log);
    const limited = typeof opts.maxCourses === 'number' ? list.slice(0, opts.maxCourses) : list;
    log(`📋 清单盘点: 去重后共 ${list.length} 门课程，本次处理 ${limited.length} 门`);

    // Phase2: 逐条访问判定类型/取内容(跨板块重复笔记走缓存)
    const noteCache = new Map<string, { title: string; desc: string; hasVideo: boolean; mediaUrl?: string }>();
    for (const item of limited) {
      const noteId = item.href.match(/explore\/([a-f0-9]+)/)?.[1] ?? '';
      try {
        let n = noteCache.get(noteId);
        if (!n) {
          n = await fetchNote(page, item.href);
          if (noteId) noteCache.set(noteId, n);
        }
        courses.push(Object.assign({
          category: item.category,
          title: n.title || item.title,
          url: item.href,
          noteId,
          type: (n.hasVideo ? '视频' : '图文') as AcademyCourse['type'],
          contentChars: n.desc.length,
        }, { __desc: n.desc, __mediaUrl: n.mediaUrl || '' }));
        log(`✅ [${n.hasVideo ? '视频' : '图文'}] ${n.title || item.title}`);
      } catch (e) {
        const msg = `${item.title}: ${e instanceof Error ? e.message : e}`;
        detailFailed++;
        errors.push(msg);
        log(`⚠️ 跳过 ${msg}`);
      }
      await sleep(1200);
    }
  } finally {
    try { await browser.close(); } catch { /* ignore */ }
  }

  const image = courses.filter((c) => c.type === '图文').length;
  const videos = courses.filter((c) => c.type === '视频');
  log(`📊 盘点完成: 图文 ${image} 篇 / 视频 ${videos.length} 门`);

  const videoDir = join(outDir, '.transcribe-work', 'videos');
  const workDir = join(outDir, '.transcribe-work');

  // Phase3a: 先把全部视频下载到本地(可并发、可断点续传)
  if ((opts.downloadOnly || opts.transcribe) && videos.length > 0) {
    const targets = videos
      .map((c) => {
        const mediaUrl = (c as any).__mediaUrl as string;
        if (!mediaUrl) {
          c.downloadStatus = 'missing-media';
          c.downloadError = '未捕获到视频媒体地址';
          mediaMissing++;
          errors.push(`${c.title}: 未捕获到视频媒体地址`);
          return null;
        }
        c.downloadStatus = 'pending';
        return { noteId: c.noteId, title: c.title, mediaUrl, course: c };
      })
      .filter((t): t is { noteId: string; title: string; mediaUrl: string; course: AcademyCourse } => t !== null);
    log(`⬇️ 待下载视频 ${targets.length} 个，媒体地址缺失 ${videos.length - targets.length} 个（并发 3）`);
    const summary = await downloadVideos(targets, videoDir, log);
    Object.assign(download, summary);
    log(`⬇️ 下载汇总: 目标 ${summary.total} / 已有 ${summary.existing} / 新增 ${summary.downloaded} / 失败 ${summary.failed}`);
  }
    if (opts.downloadOnly) {
    return finalizeOutput(outDir, fetchedAt, courses, errors, log, { detailFailed, mediaMissing, download, transcription });
  }

  // Phase3b: 并发转写(下载完成后自动开始;已有逐字稿跳过)
  if (opts.transcribe && videos.length > 0) {
    const config = resolveTranscribeConfig();
    const CONC = config.concurrency;
    const pending = videos
      .filter((c) => existsSync(join(videoDir, `${c.noteId}.mp4`)))
      .filter((c) => {
        const md = join(outDir, '学院视频', `${safeName(c.title) || c.noteId}.md`);
        return !(existsSync(md) && readFileSync(md, 'utf-8').includes('【视频逐字稿】'));
      });
    transcription.targeted = pending.length;
    transcription.notDownloaded = videos.filter((c) => !existsSync(join(videoDir, `${c.noteId}.mp4`))).length;
    log(`🎧 待转写 ${pending.length} 门（设备 ${config.device} / ${config.computeType} / 并发 ${CONC}）`);
    let idx = 0;
    let started = 0;
    const worker = async () => {
      while (idx < pending.length) {
        const c = pending[idx++];
        const no = ++started;
        const fp = join(videoDir, `${c.noteId}.mp4`);
        try {
          log(`🎧 [${no}/${pending.length}] 转写: ${c.title}`);
          const text = await transcribeLocalVideo(fp, workDir, config);
          if (text) {
            (c as any).__transcript = text;
            c.transcribed = true;
            (c as any).__transcribed = true;
            transcription.succeeded++;
            log(`✅ [${no}] 完成 ${text.length} 字: ${c.title}`);
          } else {
            c.transcriptionError = '转写结果为空';
            transcription.failed++;
            errors.push(`${c.title}: 转写结果为空`);
            log(`⚠️ [${no}] 转写结果为空: ${c.title}`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          c.transcriptionError = msg;
          transcription.failed++;
          errors.push(`${c.title}: ${msg}`);
          log(`⚠️ [${no}] 转写失败(保留简介占位): ${c.title} — ${msg}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, pending.length) }, worker));
  }

  return finalizeOutput(outDir, fetchedAt, courses, errors, log, { detailFailed, mediaMissing, download, transcription });
}

async function finalizeOutput(
  outDir: string,
  fetchedAt: string,
  courses: AcademyCourse[],
  errors: string[],
  log: (m: string) => void,
  summary: Omit<AcademySummary, 'failedCourses' | 'errorCount'>,
): Promise<AcademyResult> {
  mkdirSync(outDir, { recursive: true });
  const image = courses.filter((c) => c.type === '图文').length;
  const failedCourses = new Set(courses.filter((c) => c.downloadStatus === 'missing-media' || c.downloadStatus === 'failed' || c.transcriptionError).map((c) => c.noteId)).size + summary.detailFailed;
  const finalSummary: AcademySummary = { ...summary, failedCourses, errorCount: errors.length };

  const videoList = courses.filter((c) => c.type === '视频');
  const byCat = new Map<string, AcademyCourse[]>();
  for (const c of courses) {
    if (c.type !== '图文') continue;
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category)!.push(c);
  }
  const files: string[] = [];
  for (const [cat, items] of byCat) {
    const lines = [`# 创作学院 · ${cat}`, '', `> 采集时间: ${fetchedAt}`, '', `共 ${items.length} 篇图文课程`, ''];
    for (const c of items) {
      lines.push(`## ${c.title}`, '', `> 来源: ${c.url}`, '', ((c as any).__desc as string) || '(无正文)', '');
    }
    const fp = join(outDir, `创作学院-${cat}.md`);
    writeFileSync(fp, lines.join('\n'), 'utf-8');
    files.push(fp);
  }

  // —— 视频:一课一档 ——
  const videoDir = join(outDir, '学院视频');
  mkdirSync(videoDir, { recursive: true });
  for (const c of videoList) {
    const safe = safeName(c.title) || c.noteId;
    const fp = join(videoDir, `${safe}.md`);
    const transcript = (c as any).__transcript as string | undefined;
    const desc = ((c as any).__desc as string) || '(无简介)';
    const headerLines = [
      `# ${c.title}`,
      '',
      `> 视频课 · 分类: ${c.category} · 采集时间: ${fetchedAt}`,
      `> 来源: ${c.url}`,
      '',
    ];
    if (transcript) {
      writeFileSync(fp, [...headerLines, '【视频逐字稿】', '', transcript, '', '---', '', `【官方简介】`, '', desc].join('\n'), 'utf-8');
      files.push(fp);
    } else if (!existsSync(fp) || !readFileSync(fp, 'utf-8').includes('【视频逐字稿】')) {
      // 仅当已有文档不含逐字稿时才写占位版(保护既有成果)
      writeFileSync(fp, [...headerLines, '【视频课·待转写】官方简介如下：', '', desc].join('\n'), 'utf-8');
      files.push(fp);
    } else {
      log(`🔒 保留已有逐字稿: ${safe}.md`);
    }
  }

  // —— 索引 ——
  writeFileSync(
    join(outDir, 'academy-index.json'),
    JSON.stringify({
      fetchedAt,
      inventory: { total: courses.length, image, video: videoList.length },
      summary: finalSummary,
      errors,
      courses: courses.map((c) => ({
        category: c.category, title: c.title, url: c.url, noteId: c.noteId,
        type: c.type, contentChars: c.contentChars,
        downloadStatus: c.downloadStatus,
        downloadError: c.downloadError,
        transcribed: c.type === '视频' ? c.transcribed === true || (c as any).__transcribed === true : undefined,
        transcriptionError: c.transcriptionError,
      })),
    }, null, 2),
    'utf-8',
  );

  return {
    outDir,
    fetchedAt,
    inventory: { total: courses.length, image, video: videoList.length },
    summary: finalSummary,
    errors,
    courses,
    files,
  };
}
