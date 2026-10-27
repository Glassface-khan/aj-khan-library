"""Offline regression checks for manual M4B finish payload. No network or production writes."""
import ast
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ops" / "ajk_private_auto_m4b_backup.py"


def extract_finish_payload_logic():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    execute = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "execute")
    assignments = [
        n for n in execute.body
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "finish_payload" for t in n.targets)
    ]
    # Payload construction is inside execute; verify AST shape without executing network code.
    assert len(assignments) == 1, "finish_payload must be assigned once"
    payload = assignments[0]
    conditional = next(n for n in execute.body if isinstance(n, ast.If) and isinstance(n.test, ast.Name) and n.test.id == "target" and any(isinstance(x, ast.Assign) and any(isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == "finish_payload" for t in x.targets) for x in n.body))
    assert len(conditional.body) == 1
    assign = conditional.body[0]
    assert isinstance(assign, ast.Assign) and isinstance(assign.targets[0], ast.Subscript)
    assert isinstance(assign.targets[0].value, ast.Name) and assign.targets[0].value.id == "finish_payload"
    assert isinstance(assign.targets[0].slice, ast.Constant) and assign.targets[0].slice.value == "targetJobId"
    finish = next(n for n in execute.body if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
                  and isinstance(n.value.func, ast.Name) and n.value.func.id == "edge"
                  and n.value.args and isinstance(n.value.args[0], ast.Constant) and n.value.args[0].value == "finish")
    assert isinstance(finish.value.args[1], ast.Name) and finish.value.args[1].id == "finish_payload"
    return compile(ast.Module(body=[payload, conditional], type_ignores=[]), "<payload>", "exec")


class ManualFinishPayloadTests(unittest.TestCase):
    def make_payload(self, target):
        env = {"job_id": "job-uuid", "dest": "private-folder", "results": [{"name": "m4b-001.m4b"}], "target": target}
        exec(extract_finish_payload_logic(), env)
        return env["finish_payload"]

    def test_manual_target_forwarded(self):
        self.assertEqual(self.make_payload("014400c6-8f84-42e0-9838-cebd53dd202d")["targetJobId"],
                         "014400c6-8f84-42e0-9838-cebd53dd202d")

    def test_schedule_has_no_target(self):
        self.assertNotIn("targetJobId", self.make_payload(""))

    def test_common_fields_unchanged(self):
        for target in ("", "014400c6-8f84-42e0-9838-cebd53dd202d"):
            p = self.make_payload(target)
            self.assertEqual((p["jobId"], p["folderId"], p["files"]),
                             ("job-uuid", "private-folder", [{"name": "m4b-001.m4b"}]))

    def test_missing_manual_target_must_not_be_treated_as_valid_manual_finish(self):
        # This tests payload absence only. Rejection of a manual finish without target
        # is enforced by the existing Edge Function, not by the Python payload builder.
        self.assertNotIn("targetJobId", self.make_payload(""))


if __name__ == "__main__":
    unittest.main()
