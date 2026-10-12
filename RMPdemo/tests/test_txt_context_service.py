import tempfile
import unittest
from pathlib import Path


class TxtContextServiceTests(unittest.TestCase):
    def test_search_includes_markdown_policy_files(self):
        from pathfinder_ucd_modern.services.TxtContextService import TxtContextService

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "writing_requirements.md").write_text(
                "# UC Davis Writing Requirements\nELWR Writing Placement Survey UWP 7M multilingual writing.",
                encoding="utf-8",
            )
            (root / "AP.txt").write_text("Advanced Placement credit.", encoding="utf-8")

            result = TxtContextService(root).search("ELWR writing placement", limit=2)

        self.assertGreaterEqual(result["count"], 1)
        self.assertEqual(result["matches"][0]["source"], "writing_requirements.md")

    def test_new_uc_davis_policy_docs_are_retrievable(self):
        from pathfinder_ucd_modern.services.TxtContextService import TxtContextService

        service = TxtContextService()

        writing = service.search("Do I need UWP 7M for ELWR writing placement?", limit=1)
        registration = service.search("How do waitlists and 10-day drop deadlines work?", limit=1)
        international = service.search("Can an F-1 student take reduced course load below 12 units?", limit=1)
        resources = service.search("Where do I find MyBill and Canvas?", limit=1)

        self.assertEqual(writing["matches"][0]["source"], "writing_requirements.md")
        self.assertEqual(registration["matches"][0]["source"], "course_selection_policies.md")
        self.assertEqual(international["matches"][0]["source"], "international_student_course_planning.md")
        self.assertEqual(resources["matches"][0]["source"], "ucdavis_common_resources_index.md")

    def test_common_resource_index_covers_more_policy_routing_queries(self):
        from pathfinder_ucd_modern.services.TxtContextService import TxtContextService

        service = TxtContextService()

        cases = [
            "How do I file a retroactive drop petition or general appeal?",
            "Where is the FERPA student privacy policy?",
            "What does pass time unit cap mean?",
            "How does the waitlist grace period work?",
            "Where are student conduct and academic misconduct policies?",
            "How do I return to UC Davis after withdrawal or PELP?",
        ]

        for query in cases:
            with self.subTest(query=query):
                result = service.search(query, limit=1)
                self.assertEqual(result["matches"][0]["source"], "ucdavis_common_resources_index.md")

    def test_chat_service_infers_txt_context_for_new_policy_topics(self):
        from pathfinder_ucd_modern.services.LLMChatService import infer_txt_context_query

        writing = infer_txt_context_query("Do I need UWP 7M for ELWR?")
        registration = infer_txt_context_query("How does the UC Davis waitlist work after the 10-day drop deadline?")
        international = infer_txt_context_query("Can an F-1 student take a reduced course load below 12 units?")
        resources = infer_txt_context_query("Where do I find MyBill and Canvas?")

        self.assertIsNotNone(writing)
        self.assertIsNotNone(registration)
        self.assertIsNotNone(international)
        self.assertIsNotNone(resources)


if __name__ == "__main__":
    unittest.main()
