import argparse
from pathlib import Path

from pathfinder_ucd_modern.services.CourseMergeService import CourseMergeService


def parse_args():
    parser = argparse.ArgumentParser(description="Merge noisy RMP course names per professor.")
    parser.add_argument("--rmp-db", type=Path, default=None, help="Path to modern rmp.db")
    parser.add_argument("--courses-db", type=Path, default=None, help="Path to official courses.db")
    return parser.parse_args()


def main():
    args = parse_args()
    service = CourseMergeService(
        rmp_db_path=args.rmp_db or CourseMergeService.__init__.__defaults__[0],
        courses_db_path=args.courses_db or CourseMergeService.__init__.__defaults__[1],
    )
    print(service.merge_all_professor_courses())


if __name__ == "__main__":
    main()

