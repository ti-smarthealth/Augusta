"""Unit tests for the row grouping. Run: python -m unittest discover -s ocr"""

import unittest

from rows import group_rows, line_from_engine


def box(x0, y0, x1, y1):
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


class RowGrouping(unittest.TestCase):
    def test_boxes_on_one_printed_line_join_left_to_right(self):
        # Arrives out of order on purpose: the detector does not promise any.
        lines = [
            line_from_engine(box(300, 100, 340, 120), "6.5", 0.99),
            line_from_engine(box(10, 101, 120, 121), "糖化血色素", 0.98),
            line_from_engine(box(400, 99, 430, 119), "%", 0.9),
            line_from_engine(box(130, 100, 200, 120), "HbA1c", 0.97),
        ]
        rows = group_rows(lines)
        self.assertEqual([r["text"] for r in rows], ["糖化血色素 HbA1c 6.5 %"])

    def test_separate_lines_become_separate_rows_top_to_bottom(self):
        lines = [
            line_from_engine(box(10, 200, 100, 220), "Creatinine", 0.9),
            line_from_engine(box(300, 200, 340, 220), "1.1", 0.9),
            line_from_engine(box(10, 100, 100, 120), "Glucose", 0.9),
            line_from_engine(box(300, 100, 340, 120), "98", 0.9),
        ]
        rows = group_rows(lines)
        self.assertEqual([r["text"] for r in rows], ["Glucose 98", "Creatinine 1.1"])

    def test_tolerance_scales_with_box_height(self):
        # A heading twice the height of body text still forms one row with a
        # value box that sits slightly off its centre line.
        lines = [
            line_from_engine(box(10, 100, 200, 140), "TOTAL CHOLESTEROL", 0.9),
            line_from_engine(box(300, 112, 340, 132), "5.2", 0.9),
        ]
        rows = group_rows(lines)
        self.assertEqual(len(rows), 1)

    def test_empty_text_is_dropped(self):
        lines = [
            line_from_engine(box(10, 100, 100, 120), "   ", 0.5),
            line_from_engine(box(10, 100, 100, 120), "Sodium", 0.9),
        ]
        self.assertEqual([r["text"] for r in group_rows(lines)], ["Sodium"])

    def test_no_lines_no_rows(self):
        self.assertEqual(group_rows([]), [])



def tilted(x0, y0, w, h, slope):
    """A box whose baseline runs at `slope` (dy per dx), as a skewed photo gives."""
    return [[x0, y0], [x0 + w, y0 + w * slope], [x0 + w, y0 + w * slope + h], [x0, y0 + h]]


class Skew(unittest.TestCase):
    def test_a_rotated_page_still_pairs_each_name_with_its_own_value(self):
        # 1.5° of rotation over a 1000px-wide page drops the right edge by
        # ~26px — more than a 20px line. Without de-skew, "WBC" (left, low)
        # groups with the value printed one row *below* it on the right.
        slope = 0.026
        names = ["WBC", "RBC", "Hb"]
        values = ["10.76", "6.01", "18.6"]
        lines = []
        for i, (n, v) in enumerate(zip(names, values)):
            y = 100 + i * 24
            lines.append(line_from_engine(tilted(10, y, 120, 20, slope), n, 0.9))
            lines.append(line_from_engine(tilted(900, y + 900 * slope, 90, 20, slope), v, 0.9))
        # Long boxes for the skew estimate — the names and values above are
        # short, and short boxes do not vote.
        for i in range(3):
            lines.append(line_from_engine(tilted(200, 100 + i * 24, 600, 20, slope), "平均紅血球血色素濃度 reference", 0.9))
        rows = group_rows(lines)
        texts = [r["text"] for r in rows]
        self.assertEqual(texts, [
            "WBC 平均紅血球血色素濃度 reference 10.76",
            "RBC 平均紅血球血色素濃度 reference 6.01",
            "Hb 平均紅血球血色素濃度 reference 18.6",
        ])

    def test_estimate_skew_ignores_short_boxes_and_sideways_photos(self):
        from rows import estimate_skew
        import math
        short = [line_from_engine(tilted(0, 0, 30, 20, 0.5), "x", 0.9)] * 5
        self.assertEqual(estimate_skew(short), 0.0)
        sideways = [line_from_engine(tilted(0, i * 30, 300, 20, 1.0), "long line of text", 0.9) for i in range(4)]
        self.assertEqual(estimate_skew(sideways), 0.0)
        gentle = [line_from_engine(tilted(0, i * 30, 300, 20, 0.02), "long line of text", 0.9) for i in range(4)]
        self.assertAlmostEqual(estimate_skew(gentle), math.atan(0.02), places=6)


if __name__ == "__main__":
    unittest.main()
