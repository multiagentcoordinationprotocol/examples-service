"""MACP Worker SDK — shared utilities for framework-backed agent workers.

Post-direct-agent-auth (ES-8) this package exposes:

* ``BootstrapContext`` / ``load_bootstrap`` — reads the bootstrap file written
  by the examples-service.
* ``ControlPlaneClient`` — READ-ONLY HTTP client for polling run state +
  canonical events.
* ``Participant`` — event-loop wrapper with handler registration. Emissions
  are routed through ``macp_sdk.DecisionSession`` over a direct gRPC channel
  to the MACP runtime.

The legacy ``MacpMessageBuilder`` and HTTP-bridge writer have been removed
(RFC-MACP-0004 §4, RFC-MACP-0001 §5.3).
"""

from macp_worker_sdk.bootstrap import (
    BootstrapContext,
    CancelCallbackContext,
    InitiatorContext,
    InitiatorSessionStart,
    PolicyHints,
    load_bootstrap,
    log_agent,
)
from macp_worker_sdk.client import ControlPlaneClient
from macp_worker_sdk.participant import Participant, from_bootstrap

__all__ = [
    'BootstrapContext',
    'CancelCallbackContext',
    'InitiatorContext',
    'InitiatorSessionStart',
    'PolicyHints',
    'load_bootstrap',
    'log_agent',
    'ControlPlaneClient',
    'Participant',
    'from_bootstrap',
]
