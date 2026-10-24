import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

GARMIN_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(GARMIN_DIR))

import routes


class FakeClient:
    def dumps(self):
        return json.dumps({"di_token": "t"})


class FakeGarmin:
    def __init__(self):
        self.client = FakeClient()
        self.calls = []

    def login(self):
        self.calls.append(("login",))
        return None, None

    def resume_login(self, client_state, mfa_code):
        self.calls.append(("resume_login", mfa_code))
        return None, None


class FakeRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


class ResumeLoginTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(routes.MFA_STATE_STORE.clear)

    def test_answers_the_pending_challenge_without_signing_in_again(self):
        garmin = FakeGarmin()
        routes.MFA_STATE_STORE["m1"] = {"garmin": garmin, "ts": 0}
        request = FakeRequest(
            {"client_state": "m1", "mfa_code": "123456", "user_id": "u1"}
        )
        with mock.patch.object(routes, "logger"):
            result = asyncio.run(routes.garmin_resume_login(request))
        self.assertEqual(result, {"status": "success", "tokens": {"di_token": "t"}})
        self.assertEqual(garmin.calls, [("resume_login", "123456")])
        self.assertNotIn("m1", routes.MFA_STATE_STORE)


if __name__ == "__main__":
    unittest.main()
