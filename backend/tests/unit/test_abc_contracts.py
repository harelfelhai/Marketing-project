"""
ABC contract tests.

Two responsibilities:
    1. Each ABC must refuse direct instantiation (TypeError).
    2. Every concrete subclass discovered at import time must:
        a. Be instantiable (no missing @abstractmethod implementations).
        b. Implement the abstract method with the correct signature.

The discovery uses `__subclasses__()`, which means any new internal subclass
added under the `modules/` package is automatically validated by this file.
"""

import inspect
from typing import Type

import pytest

from interfaces.dispatcher import BaseActionHandler
from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.verification import BaseVerificationStrategy

# Force import of the mock modules so their subclasses are registered.
from modules import mock_dispatcher, mock_feedback, mock_ingestion  # noqa: F401


class TestABCsRefuseInstantiation:
    def test_base_ingestion_routing_engine(self):
        with pytest.raises(TypeError):
            BaseIngestionRoutingEngine()  # type: ignore[abstract]

    def test_base_action_handler(self):
        with pytest.raises(TypeError):
            BaseActionHandler()  # type: ignore[abstract]

    def test_base_verification_strategy(self):
        with pytest.raises(TypeError):
            BaseVerificationStrategy()  # type: ignore[abstract]


def _discover_concrete_subclasses(abc_cls: Type) -> list:
    """
    Walk __subclasses__ for concrete production implementations.

    Scoped to the `modules.*` package — test fixtures and ad-hoc test helpers
    are deliberately excluded (they're tested via the suite that uses them).
    Internal teams adding new modules under `modules/` are automatically
    validated by this discovery.
    """
    found = []
    for sub in abc_cls.__subclasses__():
        if not inspect.isabstract(sub) and sub.__module__.startswith("modules."):
            found.append(sub)
        found.extend(_discover_concrete_subclasses(sub))
    return found


@pytest.mark.parametrize(
    "abc_cls,method_name",
    [
        (BaseIngestionRoutingEngine, "determine_immediate_action"),
        (BaseActionHandler, "execute"),
        (BaseVerificationStrategy, "evaluate_quality"),
    ],
)
def test_every_concrete_subclass_is_instantiable(abc_cls, method_name):
    subclasses = _discover_concrete_subclasses(abc_cls)
    assert subclasses, f"No concrete subclass found for {abc_cls.__name__}"
    for sub in subclasses:
        instance = sub()
        assert hasattr(instance, method_name), (
            f"{sub.__name__} missing {method_name}"
        )


@pytest.mark.parametrize(
    "abc_cls,method_name",
    [
        (BaseIngestionRoutingEngine, "determine_immediate_action"),
        (BaseActionHandler, "execute"),
        (BaseVerificationStrategy, "evaluate_quality"),
    ],
)
def test_subclass_method_signature_matches_abc(abc_cls, method_name):
    """Subclasses must implement the method with the SAME parameter names."""
    abc_sig = inspect.signature(getattr(abc_cls, method_name))
    abc_params = list(abc_sig.parameters.keys())

    for sub in _discover_concrete_subclasses(abc_cls):
        sub_sig = inspect.signature(getattr(sub, method_name))
        sub_params = list(sub_sig.parameters.keys())
        assert sub_params == abc_params, (
            f"{sub.__name__}.{method_name} params {sub_params} "
            f"!= ABC {abc_cls.__name__}.{method_name} params {abc_params}"
        )
