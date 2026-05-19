"""
interfaces package — Abstract base classes for all injectable pipeline stages.

INTERNAL ENGINEERS: Import from the specific submodule, not from here.
Each interface lives in its own file to keep the contract for each
pipeline stage self-contained and independently documentable.

    Phase 1: from interfaces.ingestion    import BaseIngestionRoutingEngine
    Phase 2: from interfaces.dispatcher   import BaseActionHandler
    Phase 3: from interfaces.verification import BaseVerificationStrategy
"""

from interfaces.ingestion import BaseIngestionRoutingEngine
from interfaces.dispatcher import BaseActionHandler
from interfaces.verification import BaseVerificationStrategy

__all__ = [
    "BaseIngestionRoutingEngine",
    "BaseActionHandler",
    "BaseVerificationStrategy",
]
