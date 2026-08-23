# run.py 执行缓慢分析与优化计划

## 概要

优化 `c:\develop\ws\xianyu-auto\src\skills\auto-list\scripts\run.py` 的 `self-publish` 命令执行速度。

## 当前状态分析

`run.py` 是网盘拉新发货流水线的编排脚本（1510 行），`self-publish` 命令把 xianyu-auto 自身打包成 zip 上架闲鱼。当前执行特别慢的根因：

### 瓶颈 1：双盘操作串行（最大瓶颈）

`cmd_self_publish()` 第 670-688 行，夸克上传和百度上传是**完全独立**的 I/O 操作，却被串行执行：
```python
# 当前：串行，总耗时 = 夸克上传 + 百度上传
run(["quarkpan", "upload", ...], check=False, timeout=600)  # 10-120s
run([BDPAN, "upload", ...], check=False, timeout=600)       # 10-120s
```
同理第 691-713 行，夸克分享和百度分享也是串行。

### 瓶颈 2：subprocess 冷启动 + 输出缓冲

`run()` 函数（第 57-72 行）每次操作都启动新 Python 进程，且用 `stdout=PIPE` 缓冲全部输出。60 秒的上传过程中用户**看不到任何输出**，以为脚本卡死。

### 瓶颈 3：yudian_publisher.py 通过 subprocess 调用

`self-publish` 中 3 次通过 `subprocess` 调用 `yudian_publisher.py`（publish/update + deliver），每次都要重新启动 Python + import httpx。

## 优化方案

### Step 1：并行化双盘操作（效果最大）

**文件**：`run.py` 的 `cmd_self_publish()` 函数

用 `concurrent.futures.ThreadPoolExecutor` 并行执行独立的 I/O 操作：

**Step 2（双盘上传）并行化**：
```python
from concurrent.futures import ThreadPoolExecutor

def _upload_quark():
    run(["quarkpan", "mkdir", quark_target], check=False)
    run(["quarkpan", "upload", str(zip_path), "--folder", quark_target, "--create-dirs"],
        check=False, timeout=600)

def _upload_baidu():
    run([BDPAN, "mkdir", baidu_target], check=False)
    run([BDPAN, "upload", str(zip_path), f"{baidu_target}/{zip_path.name}"],
        check=False, timeout=600)

with ThreadPoolExecutor(max_workers=2) as ex:
    f1 = ex.submit(_upload_quark)
    f2 = ex.submit(_upload_baidu)
    f1.result()  # 收集异常
    f2.result()
```

**Step 3（双盘分享）并行化**：同理。

**预估收益**：上传和分享各节省 50% 时间，总计节省 ~30-270 秒。

### Step 2：实时输出（改善感知）

**文件**：`run.py` 的 `run()` 函数

将 `subprocess.run(PIPE)` 改为 `subprocess.Popen` + 逐行读取：
```python
proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                        text=True, encoding='utf-8', errors='replace')
for line in proc.stdout:
    print(f"    {line}", end='', flush=True)
```

### Step 3：yudian_publisher 改为直接 import

**文件**：`run.py`

在文件顶部添加 `sys.path`：
```python
sys.path.insert(0, os.path.join(SKILLS_ROOT, "xianyu-listing", "scripts"))
```

将 `run([sys.executable, PUBLISHER, "deliver", ...])` 改为：
```python
from yudian_publisher import YuDianPublisher, get_token
publisher = YuDianPublisher(get_token())
result = publisher.deliver_product(goods_id, wp_txt)
```

**预估收益**：减少 3-10 秒 subprocess 冷启动开销。

## 验证步骤

1. 运行 `python run.py check` 确认凭证就绪
2. 运行 `python run.py self-publish --version v1.6.0 --price 9.90` 测试完整流程
3. 确认并行化后输出不交错、异常能正确报告
4. 对比优化前后总耗时
