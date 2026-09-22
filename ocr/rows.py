"""
Turn the OCR engine's flat list of text boxes into reading-order rows.

**Why this exists as its own module, with no engine import.** A lab report is a
table, and the value a person is looking for sits to the *right* of its label
on the same printed line — but the OCR engine returns one box per run of text,
in whatever order its detector found them, with no notion of a line at all.
Everything downstream (the app's field matcher) reasons about *rows*: "the
first number after the test name on the same line". Building those rows is
pure geometry over box coordinates, so it lives here where it can be unit
tested in a millisecond without loading a model, and `app.py` stays a thin
adapter around the engine.

The engine's box is four corner points; the row grouping uses only the box's
vertical centre and height. Two boxes belong to the same row when their
vertical centres are within half a box-height of each other — printed table
rows are never closer than that, and skewed phone photos rarely tilt more.

Every rule here fails silently, the same way `vocabulary.ts` warns on the app
side: a wrong grouping shows the reader a plausible-looking value from the row
above, not an error. Keep it simple enough to reason about.
"""

from __future__ import annotations

from typing import Iterable, TypedDict


class Line(TypedDict):
    text: str
    score: float
    # Axis-aligned bounds derived from the engine's four corners, in pixels of
    # the image the engine actually saw.
    x0: float
    y0: float
    x1: float
    y1: float


class Row(TypedDict):
    # The row's boxes joined left-to-right with single spaces. This is what the
    # app's matcher reads.
    text: str
    y: float
    lines: list[Line]


def line_from_engine(box: Iterable[Iterable[float]], text: str, score: float) -> Line:
    """Collapse the engine's quadrilateral to an axis-aligned box."""
    xs = [float(p[0]) for p in box]
    ys = [float(p[1]) for p in box]
    return Line(text=text.strip(), score=float(score), x0=min(xs), y0=min(ys), x1=max(xs), y1=max(ys))


def _centre_y(line: Line) -> float:
    return (line["y0"] + line["y1"]) / 2


def _height(line: Line) -> float:
    return max(line["y1"] - line["y0"], 1.0)


def group_rows(lines: Iterable[Line]) -> list[Row]:
    """
    Group boxes into rows by vertical position, then order each row left to
    right. Rows come back top to bottom.

    The tolerance is relative to the *row's* running box height rather than a
    fixed pixel count, so the same code works for a 1200px downscale and a
    4000px original, and for large-print headings next to small-print values.
    """
    ordered = sorted((l for l in lines if l["text"]), key=_centre_y)
    rows: list[dict] = []
    for line in ordered:
        cy = _centre_y(line)
        placed = False
        for row in rows:
            tol = max(row["h"], _height(line)) * 0.5
            if abs(cy - row["y"]) <= tol:
                n = len(row["lines"])
                # Running means keep a long row from drifting after one tall box.
                row["y"] = (row["y"] * n + cy) / (n + 1)
                row["h"] = (row["h"] * n + _height(line)) / (n + 1)
                row["lines"].append(line)
                placed = True
                break
        if not placed:
            rows.append({"y": cy, "h": _height(line), "lines": [line]})

    out: list[Row] = []
    for row in sorted(rows, key=lambda r: r["y"]):
        ls = sorted(row["lines"], key=lambda l: l["x0"])
        out.append(Row(text=" ".join(l["text"] for l in ls), y=row["y"], lines=ls))
    return out
