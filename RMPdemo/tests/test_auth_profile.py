import tempfile
import unittest
from pathlib import Path


class AuthProfileTests(unittest.TestCase):
    def test_uc_davis_email_validation_accepts_ucdavis_domain_only(self):
        from pathfinder_ucd_modern.web.auth import is_allowed_student_email

        self.assertTrue(is_allowed_student_email("student@ucdavis.edu"))
        self.assertTrue(is_allowed_student_email("STUDENT@UCDAVIS.EDU"))
        self.assertFalse(is_allowed_student_email("student@gmail.com"))
        self.assertFalse(is_allowed_student_email("student@ucdavis.edu.evil.com"))
        self.assertFalse(is_allowed_student_email(""))

    def test_profile_service_round_trips_student_profile(self):
        from pathfinder_ucd_modern.services.UserProfileService import UserProfileService

        with tempfile.TemporaryDirectory() as tmp:
            service = UserProfileService(Path(tmp) / "users.db")
            user = service.upsert_google_user({
                "sub": "google-sub-1",
                "email": "student@ucdavis.edu",
                "name": "Aggie Student",
                "picture": "https://example.test/avatar.png",
            })
            profile = service.save_profile(user["id"], {
                "student_type": "freshman",
                "current_major": "Computer Science",
                "target_major": "Data Science",
                "college": "College of Letters and Science",
                "entry_term": "Fall",
                "entry_year": "2026",
                "graduation_year": "2030",
                "language": "zh",
                "international_status": "yes",
                "considering_change_major": True,
                "ap_ib_summary": "AP Calc BC 5",
                "placement_summary": "Math placement done",
                "course_preferences": {
                    "priority": "GPA first",
                    "max_difficulty": "moderate",
                    "target_units": "15",
                    "self_assessment": "I learn best with structure and worry about fast STEM classes.",
                },
            })

            loaded = service.get_user_with_profile(user["id"])

        self.assertEqual(loaded["email"], "student@ucdavis.edu")
        self.assertTrue(loaded["profile_complete"])
        self.assertEqual(profile["current_major"], "Computer Science")
        self.assertEqual(loaded["profile"]["language"], "zh")
        self.assertEqual(loaded["profile"]["international_status"], "yes")
        self.assertEqual(loaded["profile"]["target_major"], "Data Science")
        self.assertEqual(loaded["profile"]["course_preferences"]["target_units"], "15")
        self.assertEqual(
            loaded["profile"]["course_preferences"]["self_assessment"],
            "I learn best with structure and worry about fast STEM classes.",
        )


class AppAuthFlowTests(unittest.TestCase):
    def make_app(self, tmp_path, chat_service=None):
        from pathfinder_ucd_modern.web.app import create_app

        app = create_app(
            user_db_path=Path(tmp_path) / "users.db",
            chat_service=chat_service,
            audit_service=None,
        )
        app.config.update(TESTING=True, SECRET_KEY="test-secret")
        return app

    def test_chat_requires_login(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = self.make_app(tmp).test_client()
            response = client.post("/api/chat", json={"message": "hello"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.get_json()["error"], "Authentication required")

    def test_google_callback_rejects_non_ucdavis_email(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            app.config["TEST_GOOGLE_USERINFO"] = {
                "sub": "bad-sub",
                "email": "student@gmail.com",
                "name": "Not Aggie",
            }
            client = app.test_client()
            response = client.get("/auth/google/callback")

        self.assertEqual(response.status_code, 403)
        self.assertIn("UC Davis", response.get_json()["error"])

    def test_frontend_pages_are_split_by_route_and_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = self.make_app(tmp).test_client()

            login = client.get("/login").get_data(as_text=True)
            onboarding = client.get("/onboarding").get_data(as_text=True)
            settings = client.get("/settings").get_data(as_text=True)
            chat = client.get("/chat").get_data(as_text=True)

        self.assertIn("/static/js/login.js", login)
        self.assertIn("/static/js/onboarding.js", onboarding)
        self.assertIn("/static/js/settings.js", settings)
        self.assertIn("/static/js/chat.js", chat)
        self.assertNotIn("/static/app.js", login + onboarding + settings + chat)
        self.assertNotIn("profileModal", chat)
        chat_js = Path("web/static/js/chat.js").read_text(encoding="utf-8")
        self.assertIn("ACTIVE_THREAD_KEY", chat_js)
        self.assertIn("/api/chat/threads", chat_js)
        self.assertNotIn("pathfinder.ucd.chat.sessions", chat_js)

    def test_chat_receives_saved_student_profile_context(self):
        class FakeChatService:
            def chat(self, **kwargs):
                return {
                    "answer": kwargs["student_profile_context"],
                    "cards": [],
                }

        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp, chat_service=FakeChatService())
            app.config["TEST_GOOGLE_USERINFO"] = {
                "sub": "good-sub",
                "email": "student@ucdavis.edu",
                "name": "Aggie Student",
            }
            client = app.test_client()
            client.get("/auth/google/callback")
            client.post("/api/profile", json={
                "student_type": "transfer",
                "current_major": "Statistics",
                "target_major": "Data Science",
                "college": "College of Letters and Science",
                "entry_term": "Fall",
                "entry_year": "2026",
                "graduation_year": "2028",
                "language": "zh",
                "international_status": "yes",
                "considering_change_major": True,
                "ap_ib_summary": "",
                "placement_summary": "Chem placement pending",
                "course_preferences": {
                    "priority": "balanced",
                    "self_assessment": "I am nervous about heavy workloads.",
                },
            })

            response = client.post("/api/chat", json={"message": "What should I take?"})

        self.assertEqual(response.status_code, 200)
        answer = response.get_json()["answer"]
        self.assertIn("Statistics", answer)
        self.assertIn("Data Science", answer)
        self.assertIn("Preferred UI language: zh", answer)
        self.assertIn("International student status: yes", answer)
        self.assertIn("Chem placement pending", answer)
        self.assertIn("I am nervous about heavy workloads.", answer)

    def test_onboarding_format_context_returns_fallback_summary_without_model(self):
        class FakeChatService:
            def client_and_model(self, _config):
                raise RuntimeError("no model configured")

        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp, chat_service=FakeChatService())
            app.config["TEST_GOOGLE_USERINFO"] = {
                "sub": "good-sub",
                "email": "student@ucdavis.edu",
                "name": "Aggie Student",
            }
            client = app.test_client()
            client.get("/auth/google/callback")

            response = client.post("/api/onboarding/format-context", json={
                "student_type": "freshman",
                "college": "College of Engineering",
                "current_major": "Computer Science",
                "target_major": "Computer Science and Engineering",
                "ap_ib_summary": "AP Calculus BC 5 and AP Chemistry 4",
                "placement_summary": "Math placement score: 35",
                "course_preferences": {
                    "priority": "",
                    "max_difficulty": "Moderate",
                    "target_units": "14-15",
                    "self_assessment": "I prefer structured classes.",
                },
            })

        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("AP Calculus BC 5", data["formatted_credit_summary"])
        self.assertIn("Student Profile Summary", data["professional_summary"])
        self.assertIn("Computer Science", data["professional_summary"])


if __name__ == "__main__":
    unittest.main()
