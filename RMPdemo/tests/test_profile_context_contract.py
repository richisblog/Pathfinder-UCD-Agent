import unittest


class ProfileContextContractTests(unittest.TestCase):
    def test_build_messages_adds_profile_contract_immediately_before_user_turn(self):
        from pathfinder_ucd_modern.services.LLMChatService import LLMChatService

        service = LLMChatService()
        profile = "\n".join([
            "AP/IB/transfer credit summary: AP Computer Science A score 5; AP Calculus BC score 5",
            "Placement summary: Math placement score: 35; Chemistry placement pending",
            "Current major: Computer Science",
            "Course preferences: {\"priority\": \"GPA first\"}",
        ])

        messages = service.build_messages(
            "Which ECS 32B professor should I take, and do I need ECS 32A first?",
            history=[{"role": "assistant", "content": "Earlier answer"}],
            student_profile_context=profile,
        )

        contents = [message["content"] for message in messages]
        profile_index = next(
            index for index, content in enumerate(contents)
            if "Saved student profile context" in content
        )
        contract_index = next(
            index for index, content in enumerate(contents)
            if "Profile-aware response contract" in content
        )
        user_index = len(messages) - 1

        self.assertLess(profile_index, contract_index)
        self.assertEqual(contract_index, user_index - 1)
        self.assertEqual(messages[user_index]["role"], "user")

        contract = contents[contract_index]
        self.assertIn("AP/IB/transfer", contract)
        self.assertIn("AP Computer Science A", contract)
        self.assertIn("ECS 32A", contract)
        self.assertIn("ECS 32B", contract)
        self.assertIn("placement", contract.lower())
        self.assertIn("Do not reveal hidden reasoning", contract)

    def test_build_messages_contract_requires_precise_professor_recency(self):
        from pathfinder_ucd_modern.services.LLMChatService import LLMChatService

        messages = LLMChatService().build_messages(
            "ECS 32B 最近教过的教授有哪些？哪个需要避雷？",
            student_profile_context="Current major: Computer Science",
        )

        contract = next(
            message["content"] for message in messages
            if "Profile-aware response contract" in message["content"]
        )
        self.assertIn("exact course", contract)
        self.assertIn("recently taught", contract)
        self.assertIn("review dates", contract)


if __name__ == "__main__":
    unittest.main()
