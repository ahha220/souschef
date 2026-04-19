"""One-off: print food_profile_summary for user_id=default. Run from backend/: python scripts/print_user_profile.py"""
import os
import sqlite3

DATABASE_PATH = os.getenv("DATABASE_PATH", "souschef.db")


def main() -> None:
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT user_id, food_profile_summary, updated_at FROM user_profiles WHERE user_id = ?",
        ("default",),
    ).fetchone()
    conn.close()

    if row is None:
        print("No row for user_id='default'.")
        conn2 = sqlite3.connect(DATABASE_PATH)
        try:
            others = conn2.execute(
                "SELECT user_id, length(food_profile_summary) FROM user_profiles"
            ).fetchall()
            if others:
                print("Other user_profiles rows (user_id, summary_len):", others)
            else:
                print("Table user_profiles is empty.")
        finally:
            conn2.close()
        return

    summary = row["food_profile_summary"] or ""
    if not str(summary).strip():
        print("Row exists for user_id='default' but food_profile_summary is empty.")
        print("updated_at:", row["updated_at"])
        return

    print("user_id:", row["user_id"])
    print("updated_at:", row["updated_at"])
    print("length:", len(summary))
    print("---")
    print(summary)


if __name__ == "__main__":
    main()
