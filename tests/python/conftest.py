"""Shared pytest fixtures for the Baton engine contract tests.

Two CLI modes:
- "fake": a deterministic shell script standing in for the CLI (hermetic; no
  Node required) — used for engine behavior tests.
- "real": the built packages/cli/dist/main.js — used for JSON-parity tests,
  skipped automatically when the artifact is absent.
"""

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PLUGIN_DIR = os.path.join(REPO_ROOT, "plugins", "context_engine")
if PLUGIN_DIR not in sys.path:
    sys.path.insert(0, PLUGIN_DIR)

from baton import BatonConfig  # noqa: E402  (plugins/context_engine/baton package)

REAL_CLI = os.path.join(REPO_ROOT, "packages", "cli", "dist", "main.js")

FAKE_CLI_TEMPLATE = r"""#!/usr/bin/env python3
import json, os, sys

LOG = os.environ["FAKE_CLI_LOG"]
STATE = os.environ["FAKE_CLI_STATE"]

def emit(obj):
    print(json.dumps(obj))

def read_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except Exception:
        return {"counter": 0}

def write_state(s):
    with open(STATE, "w") as f:
        json.dump(s, f)

def main():
    args = sys.argv[1:]
    if "--json" in args:
        args.remove("--json")
    with open(LOG, "a") as f:
        f.write(json.dumps(args) + "\n")
    state = read_state()
    state["counter"] = state.get("counter", 0) + 1

    if args[0] == "doctor":
        if state.get("fail_doctor"):
            print("error: missing (run baton init first)", file=sys.stderr)
            sys.exit(2)
        emit({"initialized": state.get("initialized", True), "broken_files": [], "git": {"vcs": None}})
    elif args[0] == "checkpoint":
        # args: ["checkpoint", "create", "--input", path]
        path = args[args.index("--input") + 1]
        with open(path) as f:
            payload = json.load(f)
        counter = state["counter"]
        emit({"handoff": {
            "id": "0198c0de-7000-7000-8000-%012d" % counter,
            "status": "draft",
            "work": {"title": payload.get("title", ""), "objective": payload.get("objective", "")},
            "summary": {"current_state": payload.get("currentState", "")},
            "captured_state": payload.get("currentState", ""),
            "constraints": payload.get("constraints", []),
            "trigger": payload.get("trigger", "manual"),
        }})
    elif args[0] == "handoff" and args[1] == "validate":
        if state.get("fail_validate"):
            sys.stderr.write("validation failed\n")
            sys.exit(3)
        emit({"status": state.get("validate_status", "pass"), "checks": [], "validated_at": "2026-09-02T00:00:00Z"})
    elif args[0] == "handoff" and args[1] == "ready":
        if state.get("fail_ready"):
            sys.stderr.write("validation failed\n")
            sys.exit(3)
        emit({"handoff": {"id": "0198c0de-7000-7000-8000-000000000001", "status": "ready"}})
    elif args[0] == "handoff" and args[1] == "list":
        emit({"handoffs": state.get("handoffs", [])})
    elif args[0] == "resume":
        emit({
            "id": "0198c0de-7000-7000-8000-000000000001",
            "title": "Fake work",
            "prompt": "# Handoff: Fake work\n\n## Objective\nobj\n\n## Verify freshness\nok",
            "markdown": "# Fake work",
            "stale_reasons": state.get("stale_reasons", []),
            "freshness": {"stale": bool(state.get("stale_reasons"))},
        })
    elif args[0] == "init":
        emit({"rootDir": os.getcwd(), "created": [], "existing": [], "configPath": ""})
    else:
        sys.stderr.write("unknown command: %s\n" % " ".join(args))
        sys.exit(2)
    write_state(state)

main()
"""


@pytest.fixture
def fake_cli(tmp_path):
    """Create a fake baton CLI script; returns (cli_path, state_path, log_path)."""
    script = tmp_path / "fake-baton"
    script.write_text(FAKE_CLI_TEMPLATE)
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    state = tmp_path / "state.json"
    log = tmp_path / "calls.log"
    state.write_text("{}")

    def set_state(**kwargs):
        current = json.loads(state.read_text())
        current.update(kwargs)
        state.write_text(json.dumps(current))

    return {
        "path": str(script),
        "state": str(state),
        "log": str(log),
        "set_state": set_state,
    }


@pytest.fixture
def engine_env(fake_cli):
    """Environment wiring the engine to the fake CLI."""
    env = dict(os.environ)
    env["FAKE_CLI_LOG"] = fake_cli["log"]
    env["FAKE_CLI_STATE"] = fake_cli["state"]
    return env


@pytest.fixture
def engine(fake_cli, monkeypatch):
    """A BatonContextEngine wired to the fake CLI in a fresh temp cwd."""
    from baton import BatonBridge, BatonContextEngine

    cwd = tempfile.mkdtemp()
    monkeypatch.chdir(cwd)
    # The fake CLI reads its log/state paths from the environment; subprocess
    # calls inherit these.
    monkeypatch.setenv("FAKE_CLI_LOG", fake_cli["log"])
    monkeypatch.setenv("FAKE_CLI_STATE", fake_cli["state"])
    bridge = BatonBridge(cli_path=fake_cli["path"], project_root=cwd)
    eng = BatonContextEngine(context_length=200000, config=BatonConfig(), bridge=bridge)
    eng._fake_cli = fake_cli
    yield eng
    shutil.rmtree(cwd, ignore_errors=True)


@pytest.fixture(scope="session")
def real_cli():
    """The built CLI; skips parity tests when the artifact is missing."""
    if not os.path.exists(REAL_CLI):
        pytest.skip("built CLI missing; run `pnpm build` first")
    return REAL_CLI


@pytest.fixture
def real_project(tmp_path, real_cli):
    """A temp git project with the real CLI available."""
    subprocess.run(["git", "init", "-q"], cwd=str(tmp_path), check=True)
    (tmp_path / "app.ts").write_text("export const app = 1;\n")
    subprocess.run(["git", "add", "."], cwd=str(tmp_path), check=True)
    subprocess.run(
        ["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"],
        cwd=str(tmp_path),
        check=True,
    )
    return {"root": str(tmp_path), "cli": real_cli}
