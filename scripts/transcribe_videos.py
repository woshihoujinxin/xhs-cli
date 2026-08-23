#!/usr/bin/env python3
"""Extract audio from videos and transcribe them with faster-whisper."""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract video audio and transcribe with faster-whisper")
    parser.add_argument("--input", required=True, help="video file or directory")
    parser.add_argument("--output", required=True, help="output directory")
    parser.add_argument("--model", default="small", help="Whisper model, default: small")
    parser.add_argument("--language", default="zh", help="language code, default: zh")
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default="auto")
    parser.add_argument("--compute-type", default=None, help="for example int8_float32 or int8")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="ffmpeg executable path")
    parser.add_argument("--force", action="store_true", help="redo completed files")
    parser.add_argument("--no-simplified", action="store_true", help="keep Whisper's original character set")
    return parser.parse_args()


def find_videos(input_path: Path) -> list[Path]:
    if input_path.is_file():
        if input_path.suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError(f"不支持的视频格式: {input_path.suffix}")
        return [input_path]
    if input_path.is_dir():
        return sorted(p for p in input_path.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS)
    raise FileNotFoundError(f"找不到输入路径: {input_path}")


def ensure_ffmpeg(executable: str) -> str:
    resolved = shutil.which(executable) if Path(executable).name == executable else executable
    if not resolved or not Path(resolved).exists():
        raise RuntimeError(f"找不到 ffmpeg: {executable}。请安装 ffmpeg 或使用 --ffmpeg 指定可执行文件。")
    return resolved


def extract_audio(ffmpeg: str, video: Path, wav: Path) -> None:
    if wav.exists() and wav.stat().st_size > 0:
        return
    wav.parent.mkdir(parents=True, exist_ok=True)
    temp = wav.with_suffix(".tmp.wav")
    if temp.exists():
        temp.unlink()
    command = [ffmpeg, "-y", "-i", str(video), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(temp)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace")
    except OSError as exc:
        raise RuntimeError(f"无法启动 ffmpeg: {exc}") from exc
    if result.returncode != 0 or not temp.exists() or temp.stat().st_size == 0:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "未知错误"
        raise RuntimeError(f"音频提取失败: {detail}")
    temp.replace(wav)


def choose_device(requested: str, compute_type: str, model_name: str) -> tuple[Any, str, str]:
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError("缺少 faster-whisper，请执行: python -m pip install faster-whisper") from exc
    if requested == "cpu":
        return WhisperModel(model_name, device="cpu", compute_type=compute_type), "cpu", compute_type
    if requested == "cuda":
        try:
            return WhisperModel(model_name, device="cuda", compute_type=compute_type), "cuda", compute_type
        except Exception as exc:
            raise RuntimeError(f"CUDA 初始化失败: {exc}. 可改用 --device cpu --compute-type int8。") from exc
    try:
        return WhisperModel(model_name, device="cuda", compute_type=compute_type), "cuda", compute_type
    except Exception as cuda_exc:
        print(f"⚠️ CUDA 不可用，回退 CPU: {cuda_exc}", file=sys.stderr)
        return WhisperModel(model_name, device="cpu", compute_type="int8"), "cpu", "int8"


def to_simplified(text: str, enabled: bool) -> str:
    if not enabled:
        return text
    try:
        from opencc import OpenCC
    except ImportError as exc:
        raise RuntimeError("缺少简繁转换依赖，请执行: python -m pip install opencc-python-reimplemented") from exc
    return OpenCC("t2s").convert(text)


def write_result(transcripts: Path, stem: str, source: Path, device: str, compute_type: str, segments: list[dict[str, Any]], elapsed: float, duration: float, simplified: bool) -> None:
    transcripts.mkdir(parents=True, exist_ok=True)
    segments = [dict(item, text=to_simplified(item["text"], simplified)) for item in segments]
    text = "".join(item["text"] for item in segments).strip()
    payload = {
        "source": str(source),
        "device": device,
        "compute_type": compute_type,
        "audio_seconds": round(duration, 2),
        "transcribe_seconds": round(elapsed, 2),
        "realtime_factor": round(elapsed / duration, 3) if duration else None,
        "text": text,
        "segments": segments,
    }
    (transcripts / f"{stem}.txt").write_text(text + "\n", encoding="utf-8")
    (transcripts / f"{stem}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> int:
    args = parse_args()
    try:
        input_path = Path(args.input).expanduser().resolve()
        output = Path(args.output).expanduser().resolve()
        videos = find_videos(input_path)
        if not videos:
            print("没有找到支持的视频文件。", file=sys.stderr)
            return 1
        ffmpeg = ensure_ffmpeg(args.ffmpeg)
        compute_type = args.compute_type or ("int8" if args.device == "cpu" else "int8_float32")
        audio_dir = output / "audio"
        transcript_dir = output / "transcripts"
        manifest_path = output / "manifest.json"
        output.mkdir(parents=True, exist_ok=True)
        manifest: dict[str, Any] = {}
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                print("⚠️ manifest.json 无法解析，将重新建立。", file=sys.stderr)
        manifest.setdefault("files", {})
        model, device, compute_type = choose_device(args.device, compute_type, args.model)
        print(f"设备: {device} / {compute_type}，模型: {args.model}，文件数: {len(videos)}")
        for index, video in enumerate(videos, 1):
            key = str(video)
            stem = video.stem
            entry = manifest["files"].get(key, {})
            if not args.force and entry.get("status") == "completed" and (transcript_dir / f"{stem}.json").exists():
                print(f"[{index}/{len(videos)}] 跳过已完成: {video.name}")
                continue
            started = time.perf_counter()
            try:
                wav = audio_dir / f"{stem}.wav"
                extract_audio(ffmpeg, video, wav)
                segments_iter, info = model.transcribe(str(wav), language=args.language, vad_filter=True)
                segments = [{"start": round(segment.start, 3), "end": round(segment.end, 3), "text": segment.text} for segment in segments_iter]
                elapsed = time.perf_counter() - started
                write_result(transcript_dir, stem, video, device, compute_type, segments, elapsed, float(info.duration), not args.no_simplified)
                manifest["files"][key] = {"status": "completed", "wav": str(wav), "transcript": str(transcript_dir / f"{stem}.json"), "audio_seconds": round(float(info.duration), 2), "transcribe_seconds": round(elapsed, 2)}
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"[{index}/{len(videos)}] ✅ {video.name}: {info.duration:.1f}s 音频，用时 {elapsed:.1f}s ({elapsed / info.duration:.2f}x)")
            except Exception as exc:
                manifest["files"][key] = {"status": "failed", "error": str(exc)}
                manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"[{index}/{len(videos)}] ❌ {video.name}: {exc}", file=sys.stderr)
        return 1 if any(item.get("status") == "failed" for item in manifest["files"].values()) else 0
    except Exception as exc:
        print(f"❌ {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
