import argparse
import datetime
import sqlite3
import shutil
import sys
from pathlib import Path

from pathfinder_ucd_modern.core.config import DB_ROOT
from pathfinder_ucd_modern.services.CourseMergeService import CourseMergeService


def parse_args():
    parser = argparse.ArgumentParser(
        description="Clean up RMP database by removing old reviews and professors with no recent reviews."
    )
    parser.add_argument(
        "--db-path",
        type=Path,
        default=DB_ROOT / "rmp.db",
        help="Path to the SQLite database file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate the cleanup process without committing changes.",
    )
    parser.add_argument(
        "--skip-backup",
        action="store_true",
        help="Do not create a backup file before modifying the database.",
    )
    return parser.parse_args()


def subtract_years(dt: datetime.date, years: int) -> datetime.date:
    """Subtracts a given number of years from a date, handling leap years safely."""
    try:
        return dt.replace(year=dt.year - years)
    except ValueError:
        # Handle leap year case: Feb 29 to Feb 28
        return dt.replace(year=dt.year - years, day=28)


def main():
    args = parse_args()
    db_path = Path(args.db_path)

    if not db_path.exists():
        print(f"Error: Database file not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    # Calculate date thresholds dynamically based on current local date
    today = datetime.date.today()
    limit_15_years = subtract_years(today, 15)
    limit_5_years = subtract_years(today, 5)

    # format as YYYY-MM-DD
    date_15_years_str = limit_15_years.strftime("%Y-%m-%d")
    date_5_years_str = limit_5_years.strftime("%Y-%m-%d")

    print(f"Current Date: {today}")
    print(f"Threshold for reviews older than 15 years: {date_15_years_str}")
    print(f"Threshold for professors with no reviews in last 5 years: {date_5_years_str}")
    print(f"Database Path: {db_path}")

    # Create backup if not dry-run and not skipped
    backup_path = db_path.with_name(db_path.name + ".bak")
    if not args.dry_run and not args.skip_backup:
        print(f"Creating backup at {backup_path}...")
        try:
            shutil.copy2(db_path, backup_path)
            print("Backup created successfully.")
        except Exception as e:
            print(f"Error creating backup: {e}", file=sys.stderr)
            sys.exit(1)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        # Initial Counts
        cursor.execute("SELECT COUNT(*) FROM professors")
        initial_prof_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM reviews")
        initial_rev_count = cursor.fetchone()[0]
        print(f"\nInitial State: {initial_prof_count} professors, {initial_rev_count} reviews")

        # 1. Delete reviews older than 15 years
        print(f"\n[1/5] Deleting reviews older than 15 years (before {date_15_years_str})...")
        cursor.execute("DELETE FROM reviews WHERE date < ?", (date_15_years_str,))
        deleted_old_reviews = cursor.rowcount
        print(f"      Deleted {deleted_old_reviews} reviews.")

        # 2. Delete professors with no reviews in the last 5 years
        print(f"[2/5] Deleting professors with no reviews in the last 5 years (since {date_5_years_str})...")
        cursor.execute("""
            DELETE FROM professors WHERE id IN (
                SELECT id FROM professors p
                WHERE NOT EXISTS (
                    SELECT 1 FROM reviews r
                    WHERE r.professor_id = p.id AND r.date >= ?
                )
            )
        """, (date_5_years_str,))
        deleted_professors = cursor.rowcount
        print(f"      Deleted {deleted_professors} professors.")

        # 3. Delete orphaned reviews of deleted professors
        print("[3/5] Deleting orphaned reviews of deleted professors...")
        cursor.execute("""
            DELETE FROM reviews WHERE professor_id NOT IN (
                SELECT id FROM professors
            )
        """)
        deleted_orphan_reviews = cursor.rowcount
        print(f"      Deleted {deleted_orphan_reviews} reviews.")

        # 4. Delete orphaned course aliases and professor courses
        print("[4/5] Deleting orphaned course aliases and professor courses...")
        cursor.execute("""
            DELETE FROM rmp_course_aliases WHERE professor_id NOT IN (
                SELECT id FROM professors
            )
        """)
        deleted_aliases = cursor.rowcount
        cursor.execute("""
            DELETE FROM professor_courses WHERE professor_id NOT IN (
                SELECT id FROM professors
            )
        """)
        deleted_prof_courses = cursor.rowcount
        print(f"      Deleted {deleted_aliases} course aliases and {deleted_prof_courses} professor courses.")

        # 5. Recalculate statistics for remaining professors
        print("[5/5] Recalculating ratings statistics for remaining professors...")
        cursor.execute("""
            UPDATE professors
            SET
                num_ratings = (
                    SELECT COUNT(*) FROM reviews WHERE professor_id = professors.id
                ),
                avg_rating = (
                    SELECT ROUND(AVG(quality_rating), 2) FROM reviews WHERE professor_id = professors.id
                ),
                avg_difficulty = (
                    SELECT ROUND(AVG(difficulty_rating), 2) FROM reviews WHERE professor_id = professors.id
                ),
                would_take_again_percent = COALESCE(
                    (
                        SELECT ROUND((SUM(CASE WHEN would_take_again = '1' THEN 1 ELSE 0 END) * 100.0) /
                                     SUM(CASE WHEN would_take_again IN ('0', '1') THEN 1 ELSE 0 END), 4)
                        FROM reviews
                        WHERE professor_id = professors.id
                    ),
                    -1.0
                )
        """)
        updated_prof_stats = cursor.rowcount
        print(f"      Recalculated stats for {updated_prof_stats} professors.")

        if args.dry_run:
            print("\n[Dry Run] Rolling back all changes...")
            conn.rollback()
            print("Rollback completed. No changes were made to the database.")
        else:
            conn.commit()
            print("\nDatabase transaction committed successfully.")

            # Close connection to allow CourseMergeService and vacuum to run
            conn.close()

            # 6. Rebuild course aliases and professor courses using CourseMergeService
            print("\nRebuilding course aliases and professor courses...")
            service = CourseMergeService(rmp_db_path=db_path)
            merge_stats = service.merge_all_professor_courses()
            print(f"Rebuild completed: {merge_stats}")

            # 7. Vacuum the database to claim back space
            print("\nVacuuming database to optimize size...")
            conn = sqlite3.connect(db_path)
            conn.execute("VACUUM")
            conn.close()

        # Print Final Statistics
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM professors")
        final_prof_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM reviews")
        final_rev_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM rmp_course_aliases")
        final_aliases_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM professor_courses")
        final_prof_courses_count = cursor.fetchone()[0]

        print("\n=== Cleanup Summary ===")
        print(f"Professors:         {initial_prof_count:6d} -> {final_prof_count:6d} (deleted {deleted_professors:d})")
        print(f"Reviews:            {initial_rev_count:6d} -> {final_rev_count:6d} (deleted {deleted_old_reviews + deleted_orphan_reviews:d})")
        print(f"  - Old Reviews:                 deleted {deleted_old_reviews:d}")
        print(f"  - Orphan Reviews:              deleted {deleted_orphan_reviews:d}")
        print(f"Course Aliases:     {final_aliases_count:6d}")
        print(f"Professor Courses:  {final_prof_courses_count:6d}")
        print("=======================")

    except Exception as e:
        print(f"\nAn error occurred during database cleanup: {e}", file=sys.stderr)
        if not args.dry_run:
            print("Attempting transaction rollback...", file=sys.stderr)
            try:
                conn.rollback()
            except Exception:
                pass
            
            if not args.skip_backup and backup_path.exists():
                print(f"Restoring database from backup {backup_path}...", file=sys.stderr)
                try:
                    conn.close()
                    shutil.copy2(backup_path, db_path)
                    print("Database successfully restored from backup.", file=sys.stderr)
                except Exception as restore_err:
                    print(f"CRITICAL: Failed to restore backup: {restore_err}", file=sys.stderr)
        sys.exit(1)
    finally:
        if 'conn' in locals() and conn:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
