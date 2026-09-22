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


if __name__ == "__main__":
    unittest.main()
