"""Parity tests against the real built CLI (spec-hermes-adapter §10).

These run the actual packages/cli/dist/main.js in a temp git project and
assert that the bridge's JSON view matches the documented CLI contract.
Skipped automatically when the build artifact is absent.
"""

import json
import os
import subprocess

import pytest

from baton import BatonBridge, BatonContextEngine, BatonConfig


def call_cli(cli, root, args, check=True):
    proc = subprocess.run(
        ["node", cli] + args, cwd=root, capture_output=True, text=True
    )
    if check and proc.returncode != 0:
        raise AssertionError("baton %s failed: %s" % (args, proc.stderr))
    return proc


def test_init_and_status_parity(real_project):
    root, cli = real_project["root"], real_project["cli"]
    bridge = BatonBridge(cli_path=cli, project_root=root)
    # Not initialized yet.
    status = bridge.status()
    assert status.get("initialized") is False
    # init via bridge, then status reports initialized.
    out = bridge.init()
    assert "config.json" in " ".join(out.get("created", []))
    status = bridge.status()
    assert status.get("initialized") is True


def test_checkpoint_validate_ready_resume_cycle(real_project):
    root, cli = real_project["root"], real_project["cli"]
    bridge = BatonBridge(cli_path=cli, project_root=root)
    bridge.init()
    created = bridge.checkpoint_create(
        {
            "title": "Parity work",
            "objective": "Bridge parity with the CLI.",
            "currentState": "Captured via bridge",
            "openItems": [
                {
                    "id": "O-001",
                    "priority": "high",
                    "description": "Next step",
                    "suggested_action": "Do it",
                }
            ],
            "artifacts": [{"path": "app.ts", "role": "modified"}],
            "trigger": "pre_compaction",
        }
    )
    handoff_id = created["handoff"]["id"]
    assert created["handoff"]["status"] == "draft"

    validation = bridge.handoff_validate(handoff_id)
    assert validation["status"] == "pass"

    ready = bridge.handoff_ready(handoff_id)
    assert ready["handoff"]["status"] == "ready"

    brief = bridge.resume(handoff_id, fmt="prompt")
    assert brief["id"] == handoff_id
    assert "## Objective" in brief["prompt"]
    assert "## Verify freshness" in brief["prompt"]
    assert brief["stale_reasons"] == []


def test_resume_brief_invariants(real_project):
    root, cli = real_project["root"], real_project["cli"]
    bridge = BatonBridge(cli_path=cli, project_root=root)
    bridge.init()
    created = bridge.checkpoint_create(
        {
            "title": "Brief invariants",
            "objective": "Brief stays bounded and structured.",
            "currentState": "state",
            "openItems": [
                {"id": "O-001", "priority": "high", "description": "d", "suggested_action": "a"}
            ],
        }
    )
    hid = created["handoff"]["id"]
    bridge.handoff_validate(hid)
    bridge.handoff_ready(hid)
    brief = bridge.resume(hid)
    assert len(brief["prompt"]) <= 4800 + 200  # ~1,200 tokens + headers
    for section in ("## Objective", "## Current state", "## First next action", "## Verify freshness"):
        assert section in brief["prompt"]


def test_exit_code_contracts(real_project):
    root, cli = real_project["root"], real_project["cli"]
    bridge = BatonBridge(cli_path=cli, project_root=root)
    bridge.init()
    # not-found -> exit 4 -> BatonBridgeError(kind="exit")
    with pytest.raises(Exception) as e:
        bridge.handoff_validate("ffffffff-ffff-ffff-ffff-ffffffffffff")
    assert "exit 4" in str(e.value)


def test_engine_end_to_end_on_real_cli(real_project):
    """Full ABC lifecycle against the real CLI in a temp git project."""
    root, cli = real_project["root"], real_project["cli"]
    bridge = BatonBridge(cli_path=cli, project_root=root)
    bridge.init()
    config = BatonConfig(fallback_token_threshold=1000)
    engine = BatonContextEngine(context_length=200000, config=config, bridge=bridge)
    engine.on_session_start("session-1")
    assert all("not initialized" not in n for n in engine._notices)

    msgs = [
        {"role": "user", "content": "Implement the OAuth callback validation"},
        {"role": "assistant", "content": "Added the timing-safe comparison helper and ran the focused suite"},
    ]
    engine.update_from_response({"prompt_tokens": 1500, "completion_tokens": 100})
    assert engine.should_compress() is True  # fallback threshold

    out = engine.compress(msgs)
    assert isinstance(out, list)
    assert out[0]["role"] == "system"
    assert "[Baton handoff" in out[0]["content"]
    assert engine.compression_count == 1

    # The handoff exists on disk with the canonical layout.
    handoff_files = os.listdir(os.path.join(root, ".baton", "handoffs"))
    assert len(handoff_files) == 1
    on_disk = json.load(open(os.path.join(root, ".baton", "handoffs", handoff_files[0])))
    assert on_disk["automation"]["trigger"] == "pre_compaction"
    assert on_disk["origin"]["harness"] == "generic"
    assert on_disk["status"] == "ready"  # validation passed, engine marked ready

    # Engine tool parity: baton_status sees the project.
    status = json.loads(engine.handle_tool_call("baton_status", {}))
    assert status["initialized"] is True
    assert status["compression_count"] == 1


def test_engine_degradation_without_init(real_project):
    root, cli = real_project["root"], real_project["cli"]
    # Intentionally skip init: project exists but Baton is not initialized.
    bridge = BatonBridge(cli_path=cli, project_root=root)
    engine = BatonContextEngine(bridge=bridge)
    engine.on_session_start("s")
    assert any("not initialized" in n for n in engine._notices)
    msgs = [{"role": "user", "content": "hello %d" % i} for i in range(15)]
    out = engine.compress(msgs)
    # compaction still happened via CLI... but checkpoint create without init
    # exits with a user error -> degradation path must engage.
    assert out[0]["role"] == "system"
    assert len(out) <= engine.config.degradation_keep_recent + 1
