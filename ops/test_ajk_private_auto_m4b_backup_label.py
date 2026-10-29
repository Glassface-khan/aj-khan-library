"""Offline regression tests for the private audiobook backup folder label."""
import unittest

from ops.ajk_private_auto_m4b_backup import safe_book_folder_name


class TestSafeBookFolderName(unittest.TestCase):
    def book(self, title, narrator="Gandalf EN", language="EN"):
        return {"title": title, "narrator": narrator, "language": language}

    def test_existing_safe_title_unchanged(self):
        self.assertEqual(
            safe_book_folder_name(self.book("The Weight of the Air", "Maggie")),
            "The Weight of the Air — Maggie — EN",
        )

    def test_newline_inside_title_is_layout_only(self):
        self.assertEqual(
            safe_book_folder_name(self.book("THE TREMBLING\nOLIVE")),
            "THE TREMBLING OLIVE — Gandalf EN — EN",
        )

    def test_crlf_and_tabs_are_collapsed(self):
        self.assertEqual(
            safe_book_folder_name(self.book("TITLE\r\nNEXT", "Gandalf\tEN")),
            "TITLE NEXT — Gandalf EN — EN",
        )

    def test_slash_refused(self):
        with self.assertRaisesRegex(RuntimeError, "unsafe_book_label"):
            safe_book_folder_name(self.book("title/unsafe"))

    def test_backslash_refused(self):
        with self.assertRaisesRegex(RuntimeError, "unsafe_book_label"):
            safe_book_folder_name(self.book("title\\unsafe"))

    def test_long_label_refused(self):
        with self.assertRaisesRegex(RuntimeError, "unsafe_book_label"):
            safe_book_folder_name(self.book("a" * 221))


if __name__ == "__main__":
    unittest.main()
