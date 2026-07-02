#!/usr/bin/env node
/** Cross-platform test runner (replaces find | xargs on Unix-only npm test). */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collectTestFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...collectTestFiles(path));
    } else if (name.endsWith('.test.js')) {
      files.push(path);
    }
  }
  return files;
}

const testDir = join(process.cwd(), 'dist-test');
const tests = collectTestFiles(testDir).sort();
if (tests.length === 0) {
  console.error('No test files found under dist-test/ — run npm run build:test first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
