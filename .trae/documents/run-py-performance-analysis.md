# run.py 性能瓶颈分析与优化计划

## 概要

分析 `c:\develop\ws\xianyu-auto\src\skills\auto-list\scripts\run.py`（1510 行）的执行缓慢问题，找出瓶颈并制定优化方案。

## 当前状态分析

`run.py` 是网盘拉新发货流水线的编排脚本，核心问题：**大量独立的 subprocess 调用被串行执行**。

### 瓶颈清单

#### 瓶颈 1：self-publish 中双盘操作串行（影响最大）

**位置**：`cmd_self_publish()` 函数（第 566-883 行）

当前流程是严格串行的 6 步：
```
打包 → 夸克上传 → 百度上传 → 夸克分享 → 百度分享 → AI生图 → 易店上架 → 设置发货
```

**可并行的独立操作**：
| 操作 | 当前耗时 | 并行后耗时 |
|------|---------|-----------|
| 夸克上传 + 百度上传 | 20-240s（串行求和） | 10-120s（取最慢） |
| 夸克分享 + 百度分享 | 10-30s（串行求和） | 5-15s（取最慢） |

**预估节省**：20-270 秒（占 self-publish 总耗时的 40-60%）

#### 瓶颈 2：subprocess 冷启动开销

**位置**：`run()` 函数（第 57-72 行），每次操作都启动新 Python 进程

self-publish 流程至少启动 6-8 个子进程（`generate.py`、`yudian_publisher.py`×2、`bdpan`×2-3、`quarkpan`×2-3），每次冷启动 Python + import 库约 0.5-2 秒。

**预估浪费**：3-16 秒

#### 瓶颈 3：subprocess 输出缓冲导致感知卡顿

**位置**：`run()` 函数（第 60-63 行）

```python
result = subprocess.run(
    cmd, text=True, encoding='utf-8', errors='replace', timeout=timeout,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
)
```

`stdout=subprocess.PIPE` 导致所有子进程输出被缓冲到内存，**子进程完全结束前用户看不到任何输出**。一个 60 秒的上传操作会让用户以为脚本卡死了。

#### 瓶颈 4：step_transfer() 中重复的检查调用

**位置**：`step_transfer()` 函数（第 259-376 行）

转存一步中会调用：
- `bdpan ls` × 1（检查已有）
- `bdpan transfer` × N
- `quarkpan search` × 1（检查已有）
- `quarkpan save` × N
- `bdpan ls` × 1（验证）
- 可能还有跨盘同步的 download + upload × N

每个调用都是完整的子进程周期。

#### 瓶颈 5：check 命令超时设置过长

**位置**：`cmd_check()` 第 918 行，`bdpan whoami` 超时 30 秒，如果 bdpan 有问题会白等 30 秒。

## 优化方案

### 方案 A：并行化独立操作（优先级最高，效果最明显）

**修改文件**：`c:\develop\ws\xianyu-auto\src\skills\auto-list\scripts\run.py`

**方法**：用 `concurrent.futures.ThreadPoolExecutor` 或 `subprocess.Popen` 并行执行独立步骤。

**具体改动**：

1. **self-publish Step 2**：夸克上传和百度上传并行
   ```python
   from concurrent.futures import ThreadPoolExecutor, as_completed

   with ThreadPoolExecutor(max_workers=2) as executor:
       future_quark = executor.submit(run, ["quarkpan", "upload", ...])
       future_baidu = executor.submit(run, [BDPAN, "upload", ...])
       # 收集结果
   ```

2. **self-publish Step 3**：夸克分享和百度分享并行
   ```python
   with ThreadPoolExecutor(max_workers=2) as executor:
       future_quark_share = executor.submit(run, ["quarkpan", "share", ...])
       future_baidu_share = executor.submit(run, [BDPAN, "share", ...])
   ```

3. **step_transfer()**：百度转存和夸克转存检查可以并行

4. **step_share()**：百度分享和夸克分享已经在一起了，可以改为并行

**预估收益**：self-publish 从 ~3-5 分钟降至 ~2-3 分钟（减少 40-60%）

### 方案 B：实时输出（改善用户体验）

**方法**：将 `run()` 函数的 `subprocess.run` + `PIPE` 改为 `subprocess.Popen` + 逐行读取输出。

```python
def run(cmd, check=True, timeout=300):
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding='utf-8', errors='replace')
    lines = []
    for line in proc.stdout:
        print(f"    {line}", end='', flush=True)
        lines.append(line)
    proc.wait(timeout=timeout)
    output = ''.join(lines).strip()
    if check and proc.returncode != 0:
        raise RuntimeError(...)
    return output
```

**预估收益**：用户感知等待时间大幅降低（从"长时间无响应"变为"实时看到进度"）

### 方案 C：减少 subprocess 调用次数（中等优先级）

**方法**：将 `yudian_publisher.py` 和 `generate.py` 的核心逻辑改为可直接 import 调用，避免 subprocess 冷启动。

当前 `self-publish` 中 3 次 subprocess 调用 `yudian_publisher.py`（publish/update + deliver），2 次调用 `generate.py`。

如果改为直接 import：
```python
# 而不是: run([sys.executable, PUBLISHER, "publish", ...])
from yudian_publisher import YuDianPublisher
publisher = YuDianPublisher(token)
result = publisher.publish(image_path, title, description, price)
```

**预估收益**：减少 3-10 秒冷启动开销

**代价**：需要修改 import 路径，确保 `yudian_publisher.py` 和 `generate.py` 可作为模块导入（当前设计为独立 CLI 脚本）。可以通过在 `run.py` 开头添加 `sys.path.insert(0, ...)` 来解决。

### 方案 D：check 命令超时优化（低优先级）

将 `bdpan whoami` 超时从 30 秒降为 10 秒。失败快速返回即可，不需要等 30 秒。

## 实施计划

### Step 1：并行化 self-publish 中的双盘操作
- 文件：`run.py` 的 `cmd_self_publish()` 函数
- 在 Step 2（双盘上传）和 Step 3（双盘分享）使用 `ThreadPoolExecutor`
- 保留错误处理：任一并行任务失败不影响另一任务的结果收集

### Step 2：实时输出
- 文件：`run.py` 的 `run()` 函数
- 将 `subprocess.run` 改为 `subprocess.Popen` + 逐行输出

### Step 3：减少 subprocess 调用
- 文件：`run.py`
- 对 `yudian_publisher.py` 改为直接 import 调用（publish/deliver/update）
- 添加 `sys.path` 处理

### Step 4：验证
- 运行 `python run.py self-publish --version test --price 9.90` 测试完整流程
- 确认并行化后输出不交错、错误能正确报告
- 对比优化前后的执行时间

## 假设与决策

- 假设用户的 Python 环境支持 `concurrent.futures`（Python 3.2+，满足要求）
- 并行化仅限 I/O 密集型操作（网络上传/下载），不涉及 CPU 密集操作
- 不改变现有的 CLI 接口和参数设计
- `yudian_publisher.py` 改为可 import 模式时，需确保其 `main()` 调用时仍然可以独立运行
