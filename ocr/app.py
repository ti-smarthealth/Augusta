"""
tish-ocr — reads a photographed lab report and writes back what it saw.

**Shape of the pipeline** (see README.md for the reasoning):

    app  ──POST /ocr/scans──▶  operation-strix  (signs two S3 URLs, no I/O)
    app  ──PUT image────────▶  s3://<bucket>/uploads/<user>/<job>.jpg
    S3   ──ObjectCreated────▶  this function
    this ──PUT json─────────▶  s3://<bucket>/results/<user>/<job>.json
    this ──DELETE───────────▶  the upload
    app  ──GET (polls)──────▶  the result, then fills the form for review

This function never touches the database and never decides what a number
*means*. It returns rows of text with coordinates; matching those rows to the
app's test fields happens on the device, against the field list the user is
already looking at, and nothing is stored until the user presses Save. Every
hospital prints a different report, so the honest contract is "here is what the
page says", not "here is your HbA1c".

**Two triggers, one function.** An S3 event carries `Records`; the hourly
EventBridge rule sends `{"command": "sweep"}`. The sweep exists because an S3
lifecycle rule cannot expire objects younger than a day, and the retention
here is an hour: the upload is deleted the moment its result is written, the
result is deleted by the sweep once it is older than `RETENTION_SECONDS`, and
the one-day lifecycle rule on the bucket is only the backstop for a function
that stopped running.
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote_plus

import boto3

import math

from rows import estimate_skew, group_rows, line_from_engine

log = logging.getLogger()
log.setLevel(logging.INFO)

s3 = boto3.client("s3")

UPLOAD_PREFIX = "uploads/"
RESULT_PREFIX = "results/"
RETENTION_SECONDS = int(os.environ.get("RETENTION_SECONDS", "3600"))
# Longest side after downscaling. Phone photos arrive at 3000–4000px; the
# recognition model reads printed text comfortably at 2000px and the runtime
# grows roughly with pixel count, so this is the accuracy/latency knob.
MAX_SIDE = int(os.environ.get("OCR_MAX_SIDE", "2000"))

_engine = None


def engine():
    """Model load is the expensive part of a cold start; do it once per container."""
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR  # noqa: WPS433 — deliberate lazy import

        t0 = time.time()
        _engine = RapidOCR()
        log.info("engine ready in %.1fs", time.time() - t0)
    return _engine


def load_image(data: bytes):
    """Bytes → RGB ndarray, honouring EXIF orientation and bounded in size."""
    import numpy as np
    from PIL import Image, ImageOps

    img = Image.open(io.BytesIO(data))
    # A phone stores the sensor's orientation as a tag rather than rotating the
    # pixels; without this, a portrait photo of a report arrives sideways and
    # the detector finds almost nothing.
    img = ImageOps.exif_transpose(img).convert("RGB")
    w, h = img.size
    scale = MAX_SIDE / max(w, h)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    # The engine works in OpenCV's BGR order.
    return np.asarray(img)[:, :, ::-1].copy(), img.size


def recognise(data: bytes) -> dict:
    t0 = time.time()
    array, (w, h) = load_image(data)
    result, _elapse = engine()(array)
    lines = [line_from_engine(box, text, score) for box, text, score in (result or [])]
    rows = group_rows(lines)
    return {
        "engine": "rapidocr_onnxruntime",
        "imageSize": [w, h],
        # Diagnostic: how far off square the photo was. Not used by the app.
        "skewDeg": round(math.degrees(estimate_skew(lines)), 2),
        "rows": rows,
        "elapsedMs": round((time.time() - t0) * 1000),
    }


def result_key_for(upload_key: str) -> str:
    stem = upload_key[len(UPLOAD_PREFIX):]
    stem = stem.rsplit(".", 1)[0] if "." in stem.rsplit("/", 1)[-1] else stem
    return f"{RESULT_PREFIX}{stem}.json"


def process_upload(bucket: str, key: str) -> None:
    if not key.startswith(UPLOAD_PREFIX):
        # The notification is filtered on the prefix, but a result written by
        # this function must never be able to re-trigger it.
        log.warning("ignoring object outside %s: %s", UPLOAD_PREFIX, key)
        return

    job_id = key.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    out = {"status": "done", "jobId": job_id}
    try:
        data = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
        out.update(recognise(data))
        log.info("job %s: %d rows in %dms", job_id, len(out["rows"]), out["elapsedMs"])
    except Exception as exc:  # noqa: BLE001 — the result document *is* the error channel
        log.exception("job %s failed", job_id)
        out = {"status": "error", "jobId": job_id, "message": f"{type(exc).__name__}: {exc}"}
    finally:
        # Written even on failure, so the app stops polling and can say why
        # rather than timing out.
        s3.put_object(
            Bucket=bucket,
            Key=result_key_for(key),
            Body=json.dumps(out, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json; charset=utf-8",
        )
        # The photo has done its job. Whatever the outcome, it does not stay.
        s3.delete_object(Bucket=bucket, Key=key)


def sweep(bucket: str, older_than: timedelta) -> int:
    """Delete every object in the bucket last modified before the cutoff."""
    cutoff = datetime.now(timezone.utc) - older_than
    deleted = 0
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        stale = [{"Key": o["Key"]} for o in page.get("Contents", []) if o["LastModified"] < cutoff]
        for i in range(0, len(stale), 1000):
            s3.delete_objects(Bucket=bucket, Delete={"Objects": stale[i:i + 1000], "Quiet": True})
        deleted += len(stale)
    log.info("sweep: deleted %d object(s) older than %s", deleted, older_than)
    return deleted


def handler(event, _context):
    if event.get("command") == "sweep":
        bucket = event.get("bucket") or os.environ["OCR_BUCKET"]
        return {"deleted": sweep(bucket, timedelta(seconds=RETENTION_SECONDS))}

    for record in event.get("Records", []):
        if record.get("eventSource") != "aws:s3":
            continue
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])
        process_upload(bucket, key)
    return {"ok": True}
