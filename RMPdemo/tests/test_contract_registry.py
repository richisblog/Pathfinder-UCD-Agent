import re
import sqlite3
import tempfile
import unittest
from pathlib import Path


class ContractRegistryTests(unittest.TestCase):
    def test_tool_names_are_consistent_across_tools_run_tool_registry_and_docs(self):
        from pathfinder_ucd_modern.services.LLMChatService import LLMChatService, TOOLS
        from pathfinder_ucd_modern.services.UserProfileService import UserProfileService

        tool_names = {tool["function"]["name"] for tool in TOOLS}
        source = Path(LLMChatService.__module__.replace(".", "/") + ".py")
        service_source = Path("services/LLMChatService.py").read_text(encoding="utf-8")
        run_tool_names = set(re.findall(r'if name == "([^"]+)"', service_source))
        doc_text = Path("docs/TOOL_PROMPT_CONTRACT.md").read_text(encoding="utf-8")

        with tempfile.TemporaryDirectory() as tmp:
            service = UserProfileService(Path(tmp) / "app.db")
            conn = sqlite3.connect(Path(tmp) / "app.db")
            registry_names = {row[0] for row in conn.execute("SELECT name FROM tool_registry")}
            conn.close()

        self.assertEqual(tool_names, run_tool_names)
        self.assertTrue(tool_names.issubset(registry_names))
        for name in tool_names:
            self.assertIn(f"`{name}`", doc_text)

    def test_schema_registry_contains_exposed_rmp_and_course_fields(self):
        from pathfinder_ucd_modern.services.CourseDbQueryService import COURSE_FIELDS
        from pathfinder_ucd_modern.services.RmpQueryService import TABLE_CONFIG
        from pathfinder_ucd_modern.services.UserProfileService import UserProfileService

        with tempfile.TemporaryDirectory() as tmp:
            service = UserProfileService(Path(tmp) / "app.db")
            conn = sqlite3.connect(Path(tmp) / "app.db")
            rows = {
                (row[0], row[1], row[2])
                for row in conn.execute("SELECT db_name, table_name, field_name FROM schema_registry WHERE tool_exposed = 1")
            }
            conn.close()

        for table_name, config in TABLE_CONFIG.items():
            for field_name in config["fields"]:
                self.assertIn(("rmp.db", table_name, field_name), rows)
        for field_name in COURSE_FIELDS:
            self.assertIn(("courses.db", "courses", field_name), rows)


if __name__ == "__main__":
    unittest.main()
