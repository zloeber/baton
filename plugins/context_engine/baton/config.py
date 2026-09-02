"""Baton engine config (spec-hermes-adapter §8).

Reads the optional ``baton:`` block from Hermes' ``config.yaml``. The
``compression.*`` block belongs to the built-in compressor and is ignored.
Falls back to environment variables so the engine is testable without a
config file.
"""

import os


class BatonConfig:
    def __init__(
        self,
        cli_path: str = None,
        auto_checkpoint_on_end: bool = True,
        fallback_token_threshold: int = 160000,
        degradation_keep_recent: int = 12,
        degradation_max_tokens: int = 4000,
        brief_max_tokens: int = 1200,
    ) -> None:
        self.cli_path = cli_path
        self.auto_checkpoint_on_end = auto_checkpoint_on_end
        self.fallback_token_threshold = fallback_token_threshold
        self.degradation_keep_recent = degradation_keep_recent
        self.degradation_max_tokens = degradation_max_tokens
        self.brief_max_tokens = brief_max_tokens

    @classmethod
    def from_mapping(cls, data: dict) -> "BatonConfig":
        data = data or {}
        return cls(
            cli_path=data.get("cli_path") or os.environ.get("BATON_CLI"),
            auto_checkpoint_on_end=bool(data.get("auto_checkpoint_on_end", True)),
            fallback_token_threshold=int(data.get("fallback_token_threshold", 160000)),
            degradation_keep_recent=int(data.get("degradation_keep_recent", 12)),
            degradation_max_tokens=int(data.get("degradation_max_tokens", 4000)),
            brief_max_tokens=int(data.get("brief_max_tokens", 1200)),
        )
