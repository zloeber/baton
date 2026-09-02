"""ContextEngine ABC stub.

Hermes' real ABC lives at ``agent.context_engine.ContextEngine``. This module
defines the same required surface so the engine can be developed and tested
without importing Hermes source (spec-hermes-adapter §10). When loaded inside
Hermes, ``BatonContextEngine`` satisfies the real ABC structurally: identical
method names, signatures, and class attributes.
"""


class ContextEngine:
    """Minimal stand-in for Hermes' agent.context_engine.ContextEngine ABC."""

    last_prompt_tokens: int = 0
    last_completion_tokens: int = 0
    last_total_tokens: int = 0
    threshold_tokens: int = 0
    context_length: int = 0
    compression_count: int = 0

    def __init__(self, context_length: int = 200000) -> None:
        self.context_length = context_length
        self.threshold_tokens = int(context_length * 0.8)

    @property
    def name(self) -> str:
        raise NotImplementedError

    def update_from_response(self, usage: dict) -> None:
        raise NotImplementedError

    def should_compress(self, prompt_tokens: int = None) -> bool:
        raise NotImplementedError

    def compress(self, messages: list, current_tokens: int = None, focus_topic: str = None) -> list:
        raise NotImplementedError

    # Optional members (defaults mirror the Hermes ABC).

    def on_session_start(self, session_id=None, **kwargs) -> None:
        return None

    def on_session_end(self, session_id=None, messages=None) -> None:
        return None

    def on_session_reset(self) -> None:
        self.last_prompt_tokens = 0
        self.last_completion_tokens = 0
        self.last_total_tokens = 0
        self.compression_count = 0

    def update_model(self, model=None, context_length: int = None, **kwargs) -> None:
        if context_length is not None:
            self.context_length = context_length
            self.threshold_tokens = int(context_length * 0.8)

    def get_tool_schemas(self) -> list:
        return []

    def handle_tool_call(self, name: str, args: dict, **kwargs):
        return '{"error": "Unknown tool: %s"}' % name

    def should_compress_preflight(self, messages: list) -> bool:
        return False

    def get_status(self) -> dict:
        return {
            "last_prompt_tokens": self.last_prompt_tokens,
            "last_completion_tokens": self.last_completion_tokens,
            "last_total_tokens": self.last_total_tokens,
            "threshold_tokens": self.threshold_tokens,
            "context_length": self.context_length,
            "compression_count": self.compression_count,
        }
