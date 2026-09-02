"""Subprocess bridge to the Baton CLI (spec-hermes-adapter §8).

The Python side is a bridge, not a port: schema, validation, redaction, and
rendering live only in the TypeScript core. The bridge invokes documented
commands with ``--json``, parses the stable contract, and fails soft — every
failure becomes ``BatonBridgeError`` carrying enough detail for the engine's
degradation path and ``get_status()``. No generic shell execution.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BRIDGE_VERSION = "hermes-0.1.0"


class BatonBridgeError(RuntimeError):
    """Raised when the Baton CLI cannot be executed or returns invalid output.

    Attributes:
        kind: machine-readable failure class used by the engine
            ("cli-missing", "exit", "invalid-json", "policy").
        stderr: trimmed stderr text (never contains record values).
    """

    def __init__(self, kind: str, message: str, stderr: str = "", returncode: int = None) -> None:
        super().__init__(message)
        self.kind = kind
        self.stderr = (stderr or "")[:400]
        self.returncode = returncode


class BatonBridge:
    """Thin, auditable wrapper around the Baton CLI."""

    def __init__(self, cli_path: str = None, project_root: str = None) -> None:
        self.cli_path = cli_path or os.environ.get("BATON_CLI")
        self.project_root = str(Path(project_root or os.getcwd()).resolve())

    # ------------------------------------------------------------- discovery

    def resolve_cli(self) -> str:
        """BATON_CLI env/config -> `baton` on PATH -> error with install hint."""
        candidates = []
        if self.cli_path:
            candidates.append(self.cli_path)
        found = shutil.which("baton")
        if found:
            candidates.append(found)
        for c in candidates:
            if os.path.isfile(c) or shutil.which(c):
                return c
        raise BatonBridgeError(
            "cli-missing",
            "Baton CLI not found. Set baton.cli_path in config.yaml, export "
            "BATON_CLI, or install the CLI: cd baton && pnpm build && npm i -g ./packages/cli",
        )

    def cli_command(self) -> list:
        """Full command to run the CLI.

        Interpreters are resolved for scripts that cannot be exec'd directly
        on all platforms: shebang scripts (e.g. the test fake CLI, which is a
        `#!/usr/bin/env python3` file) only work when the OS honors shebangs;
        windows cannot, so the interpreter is prefixed explicitly. .js/.mjs
        entrypoints get a `node` prefix.
        """
        cli = self.resolve_cli()
        if cli.endswith((".js", ".mjs")):
            return ["node", cli]
        try:
            with open(cli, "rb") as f:
                magic = f.read(2)
        except OSError:
            magic = b""
        if magic == b"#!":
            with open(cli, "rb") as f:
                first = f.readline().decode("utf-8", "replace").strip()
            interp = first[2:].strip()
            # `/usr/bin/env python3` form: take the argument after env.
            if os.path.basename(interp) == "env" or interp.endswith("/env"):
                parts = interp.split()
                interp = parts[1] if len(parts) > 1 else "python3"
            if shutil.which(interp):
                return [interp, cli]
            # Fall back to the running interpreter for python shebangs.
            if "python" in os.path.basename(interp):
                return [sys.executable, cli]
        return [cli]

    # ------------------------------------------------------------- execution

    def run(self, args: list, input_text: str = None) -> dict:
        """Run `baton [--json] <args>` in the project root and parse JSON.

        Only documented command surfaces are reachable through this method;
        args are constructed by the engine, never from raw agent input.
        """
        cmd = self.cli_command() + args
        # Insert --json right after the interpreter/cli argv[0..1] window, not
        # at a fixed index: the command may be ["node", cli, ...] or
        # ["python3", script, ...].
        if "--json" not in cmd:
            insert_at = min(2, len(cmd))
            cmd.insert(insert_at, "--json")
        try:
            proc = subprocess.run(
                cmd,
                cwd=self.project_root,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired as e:
            raise BatonBridgeError("exit", "baton CLI timed out after 30s", str(e))
        if proc.returncode != 0:
            # Exit codes per spec §11: 2 user, 3 validation, 4 not-found, 5 policy.
            raise BatonBridgeError(
                "policy" if proc.returncode == 5 else "exit",
                "baton %s failed (exit %d)" % (" ".join(args), proc.returncode),
                proc.stderr,
                returncode=proc.returncode,
            )
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise BatonBridgeError(
                "invalid-json", "baton %s returned malformed JSON: %s" % (" ".join(args), e),
                proc.stdout[:200],
            )

    # -------------------------------------------------------------- commands

    def status(self) -> dict:
        """Project status via `doctor`.

        `doctor` exits 2 when the project is uninitialized or has broken
        records; both mean Baton state exists-or-not but is queryable, so we
        report initialized=False rather than a bridge failure.
        """
        try:
            return self.run(["doctor"])
        except BatonBridgeError as e:
            if e.returncode == 2:
                return {"initialized": False}
            raise

    def detect(self, event: dict) -> dict:
        return self.run(["detect", "--event", json.dumps(event)])

    def checkpoint_create(self, payload: dict) -> dict:
        """Create a draft checkpoint from a structured payload via --input file.

        The payload is written to a temp file inside the project so it never
        crosses a shell; the CLI reads it with `checkpoint create --input`.
        """
        import tempfile

        fd, tmp_path = tempfile.mkstemp(suffix=".json", dir=self.project_root)
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(payload, f)
            out = self.run(["checkpoint", "create", "--input", tmp_path])
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        return out

    def handoff_validate(self, handoff_id: str) -> dict:
        return self.run(["handoff", "validate", handoff_id])

    def handoff_ready(self, handoff_id: str, accept_warnings: str = None) -> dict:
        args = ["handoff", "ready", handoff_id]
        if accept_warnings:
            args += ["--accept-warnings", accept_warnings]
        return self.run(args)

    def handoff_list(self, status: str = None) -> dict:
        args = ["handoff", "list"]
        if status:
            args += ["--status", status]
        return self.run(args)

    def resume(self, handoff_id: str, fmt: str = "prompt") -> dict:
        return self.run(["resume", handoff_id, "--format", fmt])

    def init(self) -> dict:
        return self.run(["init"])
