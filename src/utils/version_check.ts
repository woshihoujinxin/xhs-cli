// 版本检查工具


import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// 获取当前版本
function getCurrentVersion(): string {
  try {
    // 尝试多个可能的路径
    // 1. 全局安装时：dist/utils/../../package.json -> node_modules/xhs-cli/package.json
    // 2. 开发环境：src/utils/../../package.json -> 项目根目录/package.json
    // 3. 当前工作目录（如果用户在项目目录中运行）
    const possiblePaths = [
      join(__dirname, '..', '..', 'package.json'),  // 最可能的路径（全局安装和开发环境都适用）
      join(process.cwd(), 'package.json'),  // 当前工作目录
    ];
    for (const packagePath of possiblePaths) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'));
        if (packageJson && packageJson.version) {
          return packageJson.version;
        }
      } catch {
        // 继续尝试下一个路径
      }
    }
  } catch (error) {
    // 忽略错误
  }
  // 如果所有方法都失败，返回默认值
  return '0.0.0';
}


// 从 npm registry 获取最新版本
async function getLatestVersion(): Promise<string | null> {
  try {
    // 检查 fetch 是否可用
    if (typeof fetch === 'undefined') {
      return null;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 3000); // 3秒超时
    try {
      const response = await fetch('https://registry.npmjs.org/@easyasstudio%2Fxhs-cli/latest', {
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      return data.version || null;
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    return null;
  }
}


// 比较版本号（简单比较，支持语义化版本）
function compareVersions(current: string, latest: string): number {
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;
    if (currentPart < latestPart) {
      return -1;
    }
    if (currentPart > latestPart) {
      return 1;
    }
  }
  return 0;
}


// 检查版本更新（异步，不阻塞）
export async function checkVersionUpdate(): Promise<void> {
  try {
    const currentVersion = getCurrentVersion();
    const latestVersion = await getLatestVersion();
    if (!latestVersion) {
      return;
    }
    if (compareVersions(currentVersion, latestVersion) < 0) {
      console.error('\n📦 发现新版本！');
      console.error(`   当前版本: ${currentVersion}`);
      console.error(`   最新版本: ${latestVersion}`);
      console.error(`   更新命令: npm install -g @easyasstudio/xhs-cli@latest\n`);
    }
  } catch (error) {
    // 静默失败，不影响主流程
  }
}

