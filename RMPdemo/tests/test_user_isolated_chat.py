import tempfile
import unittest
from pathlib import Path


class UserIsolatedChatTests(unittest.TestCase):
    def make_app(self, tmp_path, chat_service=None):
        from pathfinder_ucd_modern.web.app import create_app

        app = create_app(
            user_db_path=Path(tmp_path) / "app.db",
            chat_service=chat_service,
            audit_service=None,
        )
        app.config.update(
            TESTING=True,
            SECRET_KEY="test-secret",
            TEST_APP_ENCRYPTION_KEY="test-encryption-key",
            PLATFORM_DAILY_CHAT_LIMIT=2,
        )
        return app

    def login_and_profile(self, client, email, sub):
        app = client.application
        app.config["TEST_GOOGLE_USERINFO"] = {
            "sub": sub,
            "email": email,
            "name": email.split("@")[0],
        }
        client.get("/auth/google/callback")
        client.post("/api/profile", json={
            "student_type": "freshman",
            "current_major": "Statistics",
            "target_major": "Data Science",
            "college": "College of Letters and Science",
            "entry_term": "Fall",
            "entry_year": "2026",
            "graduation_year": "2030",
            "considering_change_major": False,
            "ap_ib_summary": "AP Calc BC 5",
            "placement_summary": "Math placement done",
            "course_preferences": {"priority": "Balanced"},
        })

    def test_threads_and_messages_are_visible_across_sessions_for_same_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            first_browser = app.test_client()
            self.login_and_profile(first_browser, "student@ucdavis.edu", "sub-1")
            created = first_browser.post("/api/chat/threads", json={"title": "Planning"}).get_json()
            thread_id = created["thread"]["id"]
            first_browser.post(f"/api/chat/threads/{thread_id}/messages", json={
                "role": "user",
                "content": "I need help choosing classes.",
            })

            second_browser = app.test_client()
            self.login_and_profile(second_browser, "student@ucdavis.edu", "sub-1")
            threads = second_browser.get("/api/chat/threads").get_json()["threads"]
            messages = second_browser.get(f"/api/chat/threads/{thread_id}/messages").get_json()["messages"]

        self.assertEqual([item["id"] for item in threads], [thread_id])
        self.assertEqual(messages[0]["content"], "I need help choosing classes.")
        self.assertEqual(messages[0]["role"], "user")
        self.assertIn("created_at", messages[0])

    def test_user_cannot_read_or_delete_another_users_thread(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            user_a = app.test_client()
            self.login_and_profile(user_a, "a@ucdavis.edu", "sub-a")
            thread_id = user_a.post("/api/chat/threads", json={"title": "A private thread"}).get_json()["thread"]["id"]
            user_a.post(f"/api/chat/threads/{thread_id}/messages", json={"role": "user", "content": "private"})

            user_b = app.test_client()
            self.login_and_profile(user_b, "b@ucdavis.edu", "sub-b")
            read_response = user_b.get(f"/api/chat/threads/{thread_id}/messages")
            delete_response = user_b.delete(f"/api/chat/threads/{thread_id}")
            b_threads = user_b.get("/api/chat/threads").get_json()["threads"]

        self.assertEqual(read_response.status_code, 404)
        self.assertEqual(delete_response.status_code, 404)
        self.assertEqual(b_threads, [])

    def test_llm_settings_mask_api_key_and_user_provider_bypasses_platform_quota(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            client = app.test_client()
            self.login_and_profile(client, "student@ucdavis.edu", "sub-1")

            saved = client.post("/api/settings/llm", json={
                "mode": "user_provider",
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4.1-mini",
                "api_key": "user-owned-secret",
            }).get_json()["settings"]
            quota = client.get("/api/settings/quota").get_json()

        self.assertEqual(saved["mode"], "user_provider")
        self.assertEqual(saved["api_key_last_four"], "cret")
        self.assertNotIn("user-owned-secret", str(saved))
        self.assertTrue(quota["unlimited"])

    def test_delete_account_data_removes_profile_threads_settings_and_logs_out(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            client = app.test_client()
            self.login_and_profile(client, "student@ucdavis.edu", "sub-1")
            thread_id = client.post("/api/chat/threads", json={"title": "Planning"}).get_json()["thread"]["id"]
            client.post(f"/api/chat/threads/{thread_id}/messages", json={
                "role": "user",
                "content": "private planning note",
            })
            client.post(f"/api/chat/threads/{thread_id}/usage", json={"provider_mode": "platform_default"})
            client.post("/api/settings/llm", json={
                "mode": "user_provider",
                "provider": "openai",
                "base_url": "https://api.openai.com/v1",
                "model": "gpt-4.1-mini",
                "api_key": "user-owned-secret",
            })

            deleted = client.delete("/api/account")
            after_delete = client.get("/api/me").get_json()

            second_session = app.test_client()
            app.config["TEST_GOOGLE_USERINFO"] = {
                "sub": "sub-1",
                "email": "student@ucdavis.edu",
                "name": "student",
            }
            relogin = second_session.get("/auth/google/callback")
            me = second_session.get("/api/me").get_json()

        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(after_delete["authenticated"], False)
        self.assertEqual(relogin.location, "/onboarding")
        self.assertTrue(me["authenticated"])
        self.assertFalse(me["profile_complete"])
        self.assertIsNone(me["profile"])

    def test_platform_default_quota_blocks_after_daily_limit(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp)
            client = app.test_client()
            self.login_and_profile(client, "student@ucdavis.edu", "sub-1")
            thread_id = client.post("/api/chat/threads", json={"title": "Quota"}).get_json()["thread"]["id"]

            first = client.post(f"/api/chat/threads/{thread_id}/usage", json={"provider_mode": "platform_default"})
            second = client.post(f"/api/chat/threads/{thread_id}/usage", json={"provider_mode": "platform_default"})
            third = client.post(f"/api/chat/threads/{thread_id}/usage", json={"provider_mode": "platform_default"})
            quota = client.get("/api/settings/quota").get_json()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)
        self.assertEqual(quota["daily_limit"], 2)
        self.assertEqual(quota["remaining"], 0)

    def test_legacy_chat_endpoint_uses_platform_quota(self):
        class FakeChatService:
            def chat(self, **_kwargs):
                return {"answer": "ok", "cards": []}

        with tempfile.TemporaryDirectory() as tmp:
            app = self.make_app(tmp, chat_service=FakeChatService())
            client = app.test_client()
            self.login_and_profile(client, "student@ucdavis.edu", "sub-1")

            first = client.post("/api/chat", json={"message": "one"})
            second = client.post("/api/chat", json={"message": "two"})
            third = client.post("/api/chat", json={"message": "three"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(third.status_code, 429)


if __name__ == "__main__":
    unittest.main()
