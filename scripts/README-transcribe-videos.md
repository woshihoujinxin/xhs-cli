# 独立视频转写脚本

脚本：`scripts/transcribe_videos.py`

它不依赖 `xhs` 命令，可以直接处理本地视频：

```text
视频 → ffmpeg 提取 16kHz 单声道 WAV → faster-whisper → TXT/JSON
```

## 安装依赖

Windows PowerShell：

```powershell
python -m pip install faster-whisper opencc-python-reimplemented
ffmpeg -version
```

如果需要 CUDA，当前 GTX 1060 3GB 推荐安装 CUDA 运行库：

```powershell
python -m pip install nvidia-cublas-cu12 nvidia-cudnn-cu12
```

## 处理小红书学院已下载视频

下面这条命令只处理本机已经下载的学院 MP4，不访问小红书，也不会重新下载：

```powershell
python scripts\\transcribe_videos.py `
  --input "$env:USERPROFILE\\.config\\xhs-cli\\.cache\\wiki\\.transcribe-work\\videos" `
  --output "$env:USERPROFILE\\.config\\xhs-cli\\.cache\\wiki\\独立转写" `
  --device cuda `
  --compute-type int8_float32
```

`--input` 指向目录时会处理目录内全部视频；如果只处理一个视频，把它替换为具体 `.mp4` 文件路径。已有结果会跳过，需要重新生成时加 `--force`。


```powershell
python scripts/transcribe_videos.py `
  --input "D:\videos" `
  --output "D:\transcribe-output" `
  --device cuda `
  --compute-type int8_float32
```

GTX 1060 3GB 建议单路运行。脚本会复用已有 WAV 和已经完成的 JSON，不会重复处理。

## CPU 转写

```powershell
python scripts/transcribe_videos.py `
  --input "D:\videos" `
  --output "D:\transcribe-output" `
  --device cpu `
  --compute-type int8
```

## 处理单个视频

```powershell
python scripts/transcribe_videos.py `
  --input "D:\videos\lesson.mp4" `
  --output "D:\transcribe-output" `
  --device cuda `
  --compute-type int8_float32
```

## 输出结构

```text
D:\transcribe-output\
├── audio\
│   └── lesson.wav
├── transcripts\
│   ├── lesson.txt       # 纯文本
│   └── lesson.json      # 文本、分段时间戳、耗时和设备信息
└── manifest.json        # 断点续跑状态
```

JSON 中的 `start`/`end` 是每段语音的秒数，便于后续生成字幕或剪辑标记。

## 重新处理

默认会跳过 manifest 中已完成的文件。需要强制重做时：

```powershell
python scripts/transcribe_videos.py `
  --input "D:\videos" `
  --output "D:\transcribe-output" `
  --device cuda `
  --compute-type int8_float32 `
  --force
```

默认会把 Whisper 输出转换为简体中文。若要保留模型原始字形，加上 `--no-simplified`。已有输出需要重新生成时，使用 `--force`，例如：

```powershell
python scripts\\transcribe_videos.py --input "D:\\videos" --output "D:\\transcribe-output" --device cuda --compute-type int8_float32 --force
```

