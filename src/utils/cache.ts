// src/utils/cache.js


import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import { CACHE_DIR, ensureAppDataLayout } from '../config.js';


// 缓存数据包装类型
interface CachedData<T> {
  data: T;
  cachedAt: string; // ISO 8601 格式的时间戳
}


/**
 * 把 filename 解析到 CACHE_DIR 内的绝对路径,拒绝越界(防 ../ 路径遍历)。
 * 所有 saveToCache/loadFromCache/cacheExists/removeCache 都应通过它。
 */
function resolveUnderCacheDir(filename: string): string {
  const resolved = resolve(CACHE_DIR, filename);
  const rel = relative(CACHE_DIR, resolved);
  // rel 若以 '..' 开头或为绝对路径,说明 filename 试图越出 CACHE_DIR
  if (rel.startsWith('..') || resolve(CACHE_DIR) === resolve(rel)) {
    throw new Error(`缓存路径越界,拒绝访问: ${filename}`);
  }
  return resolved;
}


// 确保缓存根目录存在（~/.xhs-cli/.cache）
export function ensureCacheDir(): void {
  ensureAppDataLayout();
}


// 保存数据到缓存文件（自动添加时间戳）
export function saveToCache<T>(filename: string, data: T): void {
  ensureCacheDir();
  const filePath = resolveUnderCacheDir(filename);
  const dirPath = join(filePath, '..');
  if (dirPath !== CACHE_DIR && !existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  const cached: CachedData<T> = {
    data: data,
    cachedAt: new Date().toISOString(),
  };
  // 文件权限 0o600:仅所有者可读写,保护 Cookie/发布记录(Linux/macOS 生效,Windows 忽略)
  writeFileSync(filePath, JSON.stringify(cached, null, 2), { encoding: 'utf8', mode: 0o600 });
}


// 从缓存文件读取数据（支持过期检查）,参数为秒
export function loadFromCache<T>(filename: string, maxAge?: number): T | null {
  const filePath = resolveUnderCacheDir(filename);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && 'cachedAt' in parsed && 'data' in parsed) {
      const cached = parsed as CachedData<T>;
      if (maxAge !== undefined) {
        const cachedTime = new Date(cached.cachedAt).getTime();
        const now = Date.now();
        if (now - cachedTime > maxAge * 1000) {
          return null;
        }
      }
      return cached.data;
    }
    return parsed as T;
  } catch (error) {
    console.error(`⚠️ 读取缓存文件失败: ${filename}`, error);
    return null;
  }
}


// 检查缓存是否有效（基于时间）
export function isCacheValid(filename: string, maxAge: number = 3600): boolean {
  const filePath = resolveUnderCacheDir(filename);
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    const stats = statSync(filePath);
    const now = Date.now();
    return now - stats.mtime.getTime() < maxAge;
  } catch (error) {
    return false;
  }
}

// 获取缓存文件的修改时间
export function getCacheMtime(filename: string): Date | null {
  const filePath = resolveUnderCacheDir(filename);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const stats = statSync(filePath);
    return stats.mtime;
  } catch (error) {
    return null;
  }
}

// 删除缓存文件
export function removeCache(filename: string): boolean {
  const filePath = resolveUnderCacheDir(filename);
  if (!existsSync(filePath)) {
    return false;
  }
  try {
    require('fs').unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`⚠️ 删除缓存文件失败: ${filename}`, error);
    return false;
  }
}

// 清空整个缓存目录
export function clearCache(): void {
  if (existsSync(CACHE_DIR)) {
    try {
      require('fs').rmSync(CACHE_DIR, { recursive: true, force: true });
      console.error('✅ 缓存已清空');
    } catch (error) {
      console.error('❌ 清空缓存失败:', error);
    }
  }
}

// 获取缓存文件列表
export function listCacheFiles(): string[] {
  if (!existsSync(CACHE_DIR)) {
    return [];
  }
  try {
    return require('fs').readdirSync(CACHE_DIR);
  } catch (error) {
    console.error('⚠️ 获取缓存文件列表失败:', error);
    return [];
  }
}

// 检查缓存文件是否存在
export function cacheExists(filename: string): boolean {
  const filePath = resolveUnderCacheDir(filename);
  return existsSync(filePath);
}