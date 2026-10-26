"""Safety checks for the private audiobook V2 D1 schema.

Uses local SQLite only: no Cloudflare token, migration or network access.
"""
from pathlib import Path
import sqlite3
import unittest
import uuid

SQL = (Path(__file__).resolve().parents[1] / "migrations" /
       "0001_initialize.sql").read_text(encoding="utf-8")


def make_db():
    db = sqlite3.connect(":memory:")
    db.executescript(SQL)
    return db


class D1SchemaTests(unittest.TestCase):
    def test_expected_tables_created_and_no_visitor_credentials(self):
        db = make_db()
        tables = {row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue({"books", "chapters", "listening_progress",
                         "production_jobs", "voice_samples",
                         "publication_log"}.issubset(tables))
        self.assertFalse(any("password" in t.lower() or "visitor" in t.lower()
                             or "token" in t.lower() for t in tables))
        db.close()

    def test_new_book_is_not_published_by_default(self):
        db = make_db()
        id_ = str(uuid.uuid4())
        db.execute(
            "INSERT INTO books (id,title,language_code) VALUES (?,?,?)",
            (id_, "Synthetic Test Book", "EN"))
        self.assertEqual(db.execute(
            "SELECT status,is_published FROM books WHERE id=?", (id_,)
        ).fetchone(), ("draft", 0))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute("UPDATE books SET is_published=9 WHERE id=?", (id_,))
        db.close()

    def test_invalid_language_and_production_state_fail_closed(self):
        db = make_db()
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO production_jobs (id,title,language_code,voice_key,stage) "
                "VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), "Synthetic", "FR", "voice", "awaiting_source"))
        with self.assertRaises(sqlite3.IntegrityError):
            db.execute(
                "INSERT INTO production_jobs (id,title,language_code,voice_key,stage) "
                "VALUES (?,?,?,?,?)",
                (str(uuid.uuid4()), "Synthetic", "EN", "voice", "published_automatically"))
        db.close()

    def test_schema_is_idempotent_for_test_database(self):
        db = make_db()
        db.executescript(SQL)
        self.assertEqual(db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' "
            "AND name='production_jobs'").fetchone()[0], 1)
        db.close()


if __name__ == "__main__":
    unittest.main()
