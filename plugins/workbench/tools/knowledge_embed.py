#!/usr/bin/env python3
"""Local BGE embedding bridge for the workbench knowledge base.

Reads {"texts": [...]} from stdin, prints {"dims": N, "vectors": [[...]]} to stdout.

Requirements (pip install onnxruntime tokenizers numpy huggingface_hub):
  - onnxruntime + tokenizers for inference
  - huggingface_hub only needed to download the model on first use

Usage:
  python knowledge_embed.py --model bge-small-zh-v1.5

Model location:
  - env KNOWLEDGE_BGE_MODEL_DIR overrides the model directory
  - otherwise ~/.cache/knowledge-bge/<model> (downloaded from HF on first use)
"""

import json
import os
import sys
from pathlib import Path


def resolve_model_dir(model):
    override = os.environ.get("KNOWLEDGE_BGE_MODEL_DIR", "").strip()
    if override:
        return Path(override)
    return Path.home() / ".cache" / "knowledge-bge" / model


def find_onnx(model_dir):
    candidates = [
        model_dir / "onnx" / "model.onnx",
        model_dir / "model.onnx",
        model_dir / "onnx" / "model_q.onnx",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    for found in model_dir.rglob("*.onnx"):
        return found
    return None


def find_tokenizer(model_dir):
    candidates = [
        model_dir / "tokenizer.json",
        model_dir / "onnx" / "tokenizer.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    for found in model_dir.rglob("tokenizer.json"):
        return found
    return None


def ensure_model(model_dir):
    if find_onnx(model_dir) and find_tokenizer(model_dir):
        return
    try:
        from huggingface_hub import snapshot_download
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(
            "model files missing and huggingface_hub not installed: %s\n"
            "pip install huggingface_hub onnxruntime tokenizers numpy\n" % exc
        )
        sys.exit(2)
    repo = "BAAI/bge-small-zh-v1.5"
    snapshot_download(repo, local_dir=str(model_dir))
    if not (find_onnx(model_dir) and find_tokenizer(model_dir)):
        sys.stderr.write("model download finished but onnx/tokenizer files not found in %s\n" % model_dir)
        sys.exit(2)


def mean_pooling(model_output, attention_mask):
    import numpy as np

    token_embeddings = model_output[0]
    mask = np.expand_dims(attention_mask, axis=-1).astype(np.float32)
    summed = np.sum(token_embeddings * mask, axis=1)
    counts = np.clip(np.sum(mask, axis=1), a_min=1e-9, a_max=None)
    return summed / counts


def main():
    model = "bge-small-zh-v1.5"
    args = sys.argv[1:]
    for index in range(len(args) - 1):
        if args[index] == "--model":
            model = args[index + 1]
    payload = json.loads(sys.stdin.read() or '{"texts": []}')
    texts = [str(text) for text in (payload.get("texts") or [])]
    if not texts:
        sys.stdout.write(json.dumps({"dims": 0, "vectors": []}, ensure_ascii=False))
        return
    try:
        import numpy as np  # noqa: F401
        import onnxruntime as ort
        from tokenizers import Tokenizer
    except Exception as exc:
        sys.stderr.write("missing deps (pip install onnxruntime tokenizers numpy): %s\n" % exc)
        sys.exit(2)
    model_dir = resolve_model_dir(model)
    ensure_model(model_dir)
    onnx_path = find_onnx(model_dir)
    tokenizer_path = find_tokenizer(model_dir)
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    inputs = tokenizer.encode_batch(texts)
    input_ids = [item.ids for item in inputs]
    attention = [item.attention_mask for item in inputs]
    max_len = max(len(item) for item in input_ids)
    padded_ids = []
    padded_attention = []
    for ids, mask in zip(input_ids, attention):
        padded_ids.append(ids + [0] * (max_len - len(ids)))
        padded_attention.append(mask + [0] * (max_len - len(mask)))
    outputs = session.run(None, {
        "input_ids": np.array(padded_ids, dtype=np.int64),
        "attention_mask": np.array(padded_attention, dtype=np.int64),
    })
    pooled = mean_pooling(outputs, np.array(padded_attention, dtype=np.int64))
    norms = np.linalg.norm(pooled, axis=1, keepdims=True)
    normalized = pooled / np.clip(norms, a_min=1e-9, a_max=None)
    sys.stdout.write(json.dumps({
        "dims": int(normalized.shape[1]),
        "vectors": normalized.tolist(),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
