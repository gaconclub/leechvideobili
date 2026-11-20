#!/usr/bin/env python3
"""
VieNeu-TTS offline helper for GaConPro / BiliBatch Studio.
Supports preset listing, warmup download, single WAV synthesis, and fast batch synthesis.
"""
import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def _select_voice(tts, requested_voice: str | None) -> str | None:
    voices = tts.list_preset_voices() or []
    if not voices:
        return None

    ids = [v[1] for v in voices if len(v) >= 2]
    if not ids:
        return None

    if requested_voice:
        req = requested_voice.strip()
        if req in ids:
            return req
        req_lower = req.lower()
        for vid in ids:
            if vid.lower() == req_lower:
                return vid
        for desc, vid in voices:
            if req_lower in vid.lower() or req_lower in str(desc).lower():
                return vid

        # Map Studio AI voice personas to matching gender / style presets when available
        # and prioritize Northern Vietnamese (Bắc / Hà Nội) voices first
        female_hints = (
            "kore", "zephyr", "aoede", "leda", "callirrhoe", "autonoe", "despina",
            "erinome", "laomedeia", "achernar", "gacrux", "pulcherrima", "vindemiatrix",
            "sadachbia", "sulafat", "nữ", "nu", "female", "chị", "cô",
        )
        male_hints = (
            "puck", "charon", "fenrir", "orus", "enceladus", "iapetus", "umbriel",
            "algieba", "algenib", "rasalgethi", "alnilam", "schedar", "achird",
            "zubenelgenubi", "sadaltager", "nam", "male", "anh", "chú", "bác",
        )
        want_female = any(h in req_lower for h in female_hints)
        want_male = any(h in req_lower for h in male_hints)

        def is_northern(meta_text: str) -> bool:
            return any(k in meta_text for k in ("bắc", "bac", "hanoi", "hà nội", "ha noi", "north"))

        if want_female or want_male:
            for prefer_north in (True, False):
                for desc, vid in voices:
                    meta = f"{vid} {desc}".lower()
                    if prefer_north and not is_northern(meta):
                        continue
                    if want_female and ("nữ" in meta or "female" in meta or "nu " in meta):
                        return vid
                    if want_male and ("nam" in meta or "male" in meta):
                        return vid

        if any(k in req_lower for k in ("bắc", "bac", "hanoi", "hà nội", "north")):
            for desc, vid in voices:
                if is_northern(f"{vid} {desc}".lower()):
                    return vid

    default_v = getattr(tts, "_default_voice", None)
    if default_v and default_v in ids:
        return default_v
    return ids[0]


def _init_tts(mode: str, precision: str = "fp32"):
    from vieneu import Vieneu

    chosen = mode.strip().lower() if mode else "v3nano"
    if chosen == "auto":
        chosen = "v3nano"

    if chosen == "v3turbo":
        return Vieneu(mode="v3turbo", backend="auto", precision=precision), "v3turbo"
    return Vieneu(mode="v3nano"), "v3nano"


def main():
    parser = argparse.ArgumentParser(description="VieNeu-TTS offline runner")
    parser.add_argument("--mode", default="v3nano", help="v3nano | v3turbo | auto")
    parser.add_argument("--precision", default="fp32", help="fp32 | int8 (for v3turbo ONNX)")
    parser.add_argument("--list-voices", action="store_true", help="List available preset voices as JSON")
    parser.add_argument("--warmup", action="store_true", help="Pre-download and warm up offline model")
    parser.add_argument("--text-file", help="UTF-8 text file to synthesize")
    parser.add_argument("--out", help="Output .wav path")
    parser.add_argument("--voice", default="", help="Preset voice ID or hint")
    parser.add_argument("--batch-json", help="JSON file of [{text, out, voice}] items")
    args = parser.parse_args()

    try:
        tts, active_mode = _init_tts(args.mode, args.precision)
    except Exception as exc:
        # Fallback between v3turbo and v3nano if one fails
        fallback_mode = "v3turbo" if args.mode in ("v3nano", "auto") else "v3nano"
        try:
            tts, active_mode = _init_tts(fallback_mode, args.precision)
        except Exception as exc2:
            print(json.dumps({"ok": False, "error": f"Không khởi tạo được VieNeu-TTS: {exc} | {exc2}"}, ensure_ascii=False))
            sys.exit(1)

    voices = tts.list_preset_voices() or []

    if args.list_voices:
        payload = {
            "ok": True,
            "mode": active_mode,
            "sampleRate": getattr(tts, "sample_rate", 24000),
            "voices": [{"description": str(desc), "id": str(vid)} for desc, vid in voices],
        }
        print(json.dumps(payload, ensure_ascii=False))
        return

    if args.warmup:
        print(
            json.dumps(
                {
                    "ok": True,
                    "mode": active_mode,
                    "sampleRate": getattr(tts, "sample_rate", 24000),
                    "voicesCount": len(voices),
                },
                ensure_ascii=False,
            )
        )
        return

    if args.batch_json:
        items = json.loads(Path(args.batch_json).read_text(encoding="utf-8"))
        results = []
        for idx, item in enumerate(items):
            text = str(item.get("text") or "").strip()
            out_path = str(item.get("out") or "").strip()
            req_voice = str(item.get("voice") or args.voice or "").strip() or None
            if not text or not out_path:
                results.append({"index": idx, "ok": False, "error": "empty text or out"})
                continue
            resolved_voice = _select_voice(tts, req_voice)
            Path(out_path).parent.mkdir(parents=True, exist_ok=True)
            wav = tts.infer(text=text, voice=resolved_voice, apply_watermark=False)
            tts.save(wav, out_path)
            ok = Path(out_path).exists() and Path(out_path).stat().st_size > 1000
            results.append({"index": idx, "ok": ok, "out": out_path, "voice": resolved_voice})

        print(json.dumps({"ok": True, "mode": active_mode, "results": results}, ensure_ascii=False))
        return

    if args.text_file and args.out:
        text = Path(args.text_file).read_text(encoding="utf-8").strip()
        if not text:
            print(json.dumps({"ok": False, "error": "Nội dung đọc trống."}, ensure_ascii=False))
            sys.exit(1)
        resolved_voice = _select_voice(tts, args.voice or None)
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        wav = tts.infer(text=text, voice=resolved_voice, apply_watermark=False)
        tts.save(wav, args.out)
        ok = Path(args.out).exists() and Path(args.out).stat().st_size > 1000
        print(
            json.dumps(
                {
                    "ok": ok,
                    "mode": active_mode,
                    "voice": resolved_voice,
                    "out": args.out,
                },
                ensure_ascii=False,
            )
        )
        if not ok:
            sys.exit(1)
        return

    parser.print_help()
    sys.exit(1)


if __name__ == "__main__":
    main()
