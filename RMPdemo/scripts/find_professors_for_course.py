import argparse
import json
from pathlib import Path

from pathfinder_ucd_modern.services.CourseProfessorLookupService import CourseProfessorLookupService


def parse_args():
    parser = argparse.ArgumentParser(description="Find professors who taught a normalized course.")
    parser.add_argument("course", help="Course input, e.g. MAT22A, MAT 022A, ECS32A")
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--rmp-db", type=Path, default=None)
    return parser.parse_args()


def main():
    args = parse_args()
    service = CourseProfessorLookupService(args.rmp_db) if args.rmp_db else CourseProfessorLookupService()
    result = service.find_professors_for_course(args.course, limit=args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

