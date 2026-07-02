#!/usr/bin/env node
// XHS-CLI 入口：子命令见 cliRouter；业务能力见 toolset（impl*）

import { runCli } from './cliRouter.js';
import { checkVersionUpdate } from '../utils/version_check.js';

async function main() {
  void checkVersionUpdate();
  const args = process.argv.slice(2);
  try {
    await runCli(args);
  } catch (error) {
    console.error('❌ 执行出错:', error);
    if (error instanceof Error) {
      console.error('错误信息:', error.message);
    }
    process.exit(1);
  }
}

main();
