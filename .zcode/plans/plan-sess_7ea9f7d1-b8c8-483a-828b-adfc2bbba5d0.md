1. 将目录整理成清晰的职责结构：
   - `src/`：业务源码；
   - `tests/`：测试源码；
   - `scripts/`：正式可复用脚本（保留 deploy、run-tests、transcribe_videos 及其 README；保留已有 probe-article/import，因为它们是现有脚本）；
   - `docs/`：项目文档；
   - `landing/`：独立官网子项目；
   - `dist/`、`dist-test/`、`node_modules/`：本地生成/依赖目录，保留但不纳入 Git；
   - `.trae/`、`.zcode/`：工具元数据，保留不动；
   - 根目录保留配置、许可证、README、Agent 说明和工作区文件。

2. 删除明确的调试运行产物和无用缓存：
   - 根目录 `academy-run.log`、`academy-err.log`；
   - 根目录 `probe-*.json`、`tmp-probe-*.mjs`；
   - 根目录空文件 `NUL`；
   - `scripts/__pycache__/`。
   这些是探针和运行输出，不是正式源码或文档。

3. 更新根目录 `.gitignore`，忽略后续可能再次产生的：
   - `probe-*.json`、`tmp-probe-*.mjs`；
   - `academy-run.log`、`academy-err.log`；
   - `__pycache__/`、`*.pyc`。

4. 在 `scripts/README-transcribe-videos.md` 明确一条处理小红书学院本地视频的命令，使用 `.transcribe-work/videos` 输入和独立输出目录，避免用户误用目录/单文件路径。

5. 清理后运行 `npm test`，确认测试和正式脚本仍在正确位置；最后检查 `git status`，不删除任何已有业务源码、测试源码、文档、发布配置或用户未提交修改。