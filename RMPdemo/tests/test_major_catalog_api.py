import tempfile
import unittest
from pathlib import Path


class MajorCatalogApiTests(unittest.TestCase):
    def make_app(self, tmp_path):
        from pathfinder_ucd_modern.web.app import create_app

        app = create_app(
            user_db_path=Path(tmp_path) / "app.db",
            audit_service=None,
        )
        app.config.update(TESTING=True, SECRET_KEY="test-secret")
        return app

    def test_major_catalog_groups_all_change_major_majors_by_college(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = self.make_app(tmp).test_client()

            response = client.get("/api/majors/catalog")

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["total_majors"], 111)
        self.assertEqual(data["colleges"], sorted(data["colleges"]))
        self.assertEqual(
            set(data["colleges"]),
            {
                "College of Agricultural and Environmental Sciences",
                "College of Biological Sciences",
                "College of Engineering",
                "College of Letters and Science",
                "Graduate School of Management",
            },
        )
        for college, majors in data["majors_by_college"].items():
            names = [major["full_name"] for major in majors]
            self.assertEqual(names, sorted(names, key=str.casefold), college)
            self.assertTrue(all(major["college_en"] == college for major in majors))
            self.assertTrue(all(major["full_name"] and major["major_code"] for major in majors))

    def test_major_catalog_service_returns_empty_catalog_when_database_missing(self):
        from pathfinder_ucd_modern.services.ChangeMajorQueryService import ChangeMajorQueryService

        with tempfile.TemporaryDirectory() as tmp:
            catalog = ChangeMajorQueryService(Path(tmp) / "missing.db").list_major_catalog()

        self.assertEqual(catalog["colleges"], [])
        self.assertEqual(catalog["majors_by_college"], {})
        self.assertEqual(catalog["total_majors"], 0)


if __name__ == "__main__":
    unittest.main()
