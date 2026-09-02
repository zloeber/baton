"""Baton context engine for Hermes (spec-hermes-adapter.md).

Directory-discovery entry point: Hermes' context-engine loader imports this
package and expects a `ContextEngine` subclass to be exported. The ABC is
duck-typed via the bundled stub so the plugin never imports Hermes source
(vendor independence, §10); inside Hermes the same members satisfy the real
ABC structurally.
"""

from .abc import ContextEngine
from .bridge import BatonBridge, BatonBridgeError, BRIDGE_VERSION
from .config import BatonConfig
from .engine import BatonContextEngine, ENGINE_NAME

__all__ = [
    "ContextEngine",
    "BatonContextEngine",
    "BatonBridge",
    "BatonBridgeError",
    "BatonConfig",
    "ENGINE_NAME",
    "BRIDGE_VERSION",
]
