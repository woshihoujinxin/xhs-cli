/** 发布页底部操作区（暂存离开 + 发布） */
export const PUBLISH_FOOTER_SELECTORS = [
  '.publish-page-publish-btn button.ce-btn.bg-red',
  '.publish-page-publish-btn button.bg-red',
] as const;

export const PUBLISH_BUTTON_LABELS = ['发布', '立即发布'] as const;
// 注意:不要把左上角侧边栏「发布笔记」(div.btn-wrapper)当提交按钮——
// 点它只会跳转到发布中枢,内容留在草稿箱。真实提交入口见 clickWebComponentPublish。

function normalizeLabel(text: string): string {
  return text.replace(/\s+/g, '');
}

/** 在发布区容器内查找可点击的「发布」按钮（不扫描全页） */
export function findPublishButton(
  root: ParentNode,
  selectors: readonly string[] = PUBLISH_FOOTER_SELECTORS,
  labels: readonly string[] = PUBLISH_BUTTON_LABELS,
): HTMLButtonElement | null {
  const allowed = new Set(labels.map(normalizeLabel));
  for (const sel of selectors) {
    for (const b of Array.from(root.querySelectorAll(sel))) {
      const el = b as HTMLButtonElement;
      if (el.disabled) continue;
      if (allowed.has(normalizeLabel(el.textContent ?? ''))) {
        return el;
      }
    }
  }
  return null;
}

export function isPublishButtonReady(
  root: ParentNode,
  selectors: readonly string[] = PUBLISH_FOOTER_SELECTORS,
  labels: readonly string[] = PUBLISH_BUTTON_LABELS,
): boolean {
  return findPublishButton(root, selectors, labels) !== null;
}

/**
 * 点击 <xhs-publish-btn> Shadow DOM 内的提交按钮(2026-08 改版后的真实发布入口)。
 * 该元素是 Web Component,按钮藏在 Shadow DOM,普通 querySelector('button') 扫不到;
 * 若平台使用 closed shadowRoot,此处 JS 穿透会失败并返回 false,
 * 交由调用方的后续兜底链路处理(见 clickPublishViaCdpPierce)。
 */
export async function clickWebComponentPublish(
  page: import('puppeteer-core').Page,
  timeoutMs = 10000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const hosts = Array.from(document.querySelectorAll('xhs-publish-btn'));
      for (const host of hosts) {
        const r = host.getBoundingClientRect();
        if (!(r.width > 0 && r.height > 0)) continue;
        const submitText = ((host.getAttribute('submit-text') || '') || '发布').replace(/\s+/g, '');
        const root = (host as HTMLElement & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (!root) continue;
        let target: HTMLElement | null = null;
        for (const n of Array.from(root.querySelectorAll('*')) as HTMLElement[]) {
          const t = (n.innerText || n.textContent || '').replace(/\s+/g, '');
          if (!t || (t !== submitText && t !== '发布')) continue;
          const rr = n.getBoundingClientRect();
          const st = window.getComputedStyle(n);
          if (!(rr.width > 0 && rr.height > 0 && st.display !== 'none' && st.visibility !== 'hidden')) continue;
          // 遍历按文档序(父先子后),不断覆盖即得最内层命中
          if (!target || target.contains(n)) target = n;
        }
        if (target) {
          target.click();
          return true;
        }
      }
      return false;
    });
    if (clicked) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// CDP pierce 兜底：穿透 closed shadowRoot 定位并点击真实提交按钮
//
// 背景（2026-10-10 实测）：
//   <xhs-publish-btn> 的 shadowRoot 是 **closed**。这意味着：
//   - JS 侧 document.querySelectorAll 只能扫「光文档」，扫不到 shadow 内部，
//     所以上面 PUBLISH_FOOTER_SELECTORS / clickWebComponentPublish 都拿不到真实按钮。
//     （选择器本身没写错，是 closed shadow 让它失效。）
//   - 但 CDP 的 DOM.getDocument({pierce:true}) **可以**穿透 closed shadow，
//     这是 Chrome DevTools 使用的同一套能力。
//   实测穿透后拿到的真实结构：
//     <xhs-publish-btn> └─ #shadow-root └─ DIV.publish-page-publish-btn
//           ├─ BUTTON.ce-btn.white   ← 暂存离开
//           └─ BUTTON.ce-btn.bg-red  ← 发布（真实提交按钮）
//
// 为什么不用写死坐标：
//   无头模式 viewport 被固定为 1280x720，而历史兜底坐标 (934,983) 的 y 超出视口，
//   点击落在页面空白处必然失败。改为动态取盒模型中心，任意视口/缩放下都正确。
//
// 安全性：
//   Input.dispatchMouseEvent 与 page.mouse.click 是同一套 CDP 输入通道，
//   均为驱动级合成事件，不依赖窗口可见性/焦点，因此对有头模式同样安全。
//   本函数只在调用方显式传入 headless=true 时才被调用。
// ─────────────────────────────────────────────────────────────

/** 发布页 URL 特征 */
const PUBLISH_URL_RE = /\/publish\/publish/;
/** 发布成功后平台会带 published=true */
const PUBLISHED_FLAG_RE = /[?&]published=true/;

/** 在 CDP pierce 出来的完整树里找 shadow 内的提交按钮 */
function findSubmitButtonInPiercedTree(node: any): any | null {
  if (node?.nodeName === 'BUTTON') {
    const attrs: string[] = node.attributes || [];
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'class' && /\bbg-red\b/.test(attrs[i + 1] || '')) {
        return node;
      }
    }
  }
  for (const child of node?.children || []) {
    const hit = findSubmitButtonInPiercedTree(child);
    if (hit) return hit;
  }
  // closed shadow 只能通过 CDP 的 shadowRoots 访问
  for (const sr of node?.shadowRoots || []) {
    const hit = findSubmitButtonInPiercedTree(sr);
    if (hit) return hit;
  }
  if (node?.contentDocument) {
    const hit = findSubmitButtonInPiercedTree(node.contentDocument);
    if (hit) return hit;
  }
  return null;
}

/**
 * 用 CDP pierce closed shadow 定位并点击「发布」按钮。
 *
 * 流程：DOM.getDocument(pierce) → scrollIntoViewIfNeeded → getBoxModel 取中心
 *      → getNodeForLocation 校验 → dispatchMouseEvent(press/release)
 *
 * @returns 命中时返回点击坐标；未命中/环境不支持返回 null（由调用方决定后续）
 */
export async function clickPublishViaCdpPierce(
  page: import('puppeteer-core').Page,
  timeoutMs = 8000,
): Promise<{ x: number; y: number; by: string } | null> {
  let client: any;
  try {
    client = await page.createCDPSession();
    await client.send('DOM.enable');

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // 每次重取文档：页面可能仍在渲染，旧 nodeId 会失效
      const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });
      const target = findSubmitButtonInPiercedTree(root);
      if (!target?.backendNodeId) {
        await new Promise((r) => setTimeout(r, 800));
        continue;
      }

      // 底部操作栏常在 overflow 裁剪区外，必须先滚进视口
      try {
        await client.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: target.backendNodeId });
      } catch {
        continue; // 节点已失效，重取
      }
      await new Promise((r) => setTimeout(r, 600));

      const { model } = await client.send('DOM.getBoxModel', { backendNodeId: target.backendNodeId });
      const q: number[] = model.border;
      const x = Math.round((q[0] + q[2] + q[4] + q[6]) / 4);
      const y = Math.round((q[1] + q[3] + q[5] + q[7]) / 4);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      // 校验：命中点必须确实是该按钮，避免盲点
      const probe = await client.send('DOM.getNodeForLocation', {
        x, y, includeUserAgentShadowDOM: true,
      });
      if (probe?.backendNodeId !== target.backendNodeId) continue;

      // 驱动级真实鼠标事件（不依赖窗口可见性/焦点）
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x, y, button: 'none', clickCount: 0,
      });
      await client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed', x, y, button: 'left', clickCount: 1,
      });
      await new Promise((r) => setTimeout(r, 120));
      await client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased', x, y, button: 'left', clickCount: 1,
      });

      await new Promise((r) => setTimeout(r, 6000));

      const url = page.url();
      if (PUBLISHED_FLAG_RE.test(url) || !PUBLISH_URL_RE.test(url)) {
        return { x, y, by: 'cdp-pierce' };
      }
      // 未生效则继续下一轮
    }
    return null;
  } catch {
    // CDP 不可用（老版本 puppeteer / 非 CDP 传输）→ 静默返回，交回调用方
    return null;
  } finally {
    try {
      await client?.detach();
    } catch {
      /* ignore */
    }
  }
}

/**
 * 是否可判定为「已提交成功」。
 * 用 URL 的 published=true 作为判据 —— 页面会跳回上传台，
 * 页面上并不存在「发布成功」字样，靠文案匹配不可靠。
 */
export function isPublishConfirmed(url: string): boolean {
  return PUBLISHED_FLAG_RE.test(url) || !PUBLISH_URL_RE.test(url);
}