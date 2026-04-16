"""Canonical-event payload extractors used by the Participant event loop.

Envelope construction has moved to ``macp_sdk`` (direct gRPC to the runtime)
as part of ES-8 / direct-agent-auth. The legacy ``MacpMessageBuilder`` class
and its HTTP-bridge helpers have been removed — only the read-only extract
helpers remain here, because they operate on control-plane event dicts and
stay useful for polling-based event dispatch.
"""

from typing import Any, Dict, Optional

JsonDict = Dict[str, Any]


def extract_payload(event: JsonDict) -> JsonDict:
    """Extract the decoded payload from a control plane event."""
    data = event.get('data') or {}
    payload = data.get('decodedPayload') or data.get('payload') or {}
    if not payload or not isinstance(payload, dict):
        descriptor = data.get('payloadDescriptor') or {}
        proto = descriptor.get('proto') or {} if isinstance(descriptor, dict) else {}
        payload = proto.get('value') or {} if isinstance(proto, dict) else {}
    return payload if isinstance(payload, dict) else {}


def extract_proposal_id(event: JsonDict) -> Optional[str]:
    """Extract proposal_id from an event."""
    payload = extract_payload(event)
    proposal_id = payload.get('proposalId') or payload.get('proposal_id')
    if isinstance(proposal_id, str):
        return proposal_id
    subject = event.get('subject') or {}
    subject_id = subject.get('id') if isinstance(subject, dict) else None
    return subject_id if isinstance(subject_id, str) else None


def extract_sender(event: JsonDict) -> Optional[str]:
    """Extract sender from an event."""
    data = event.get('data') or {}
    sender = data.get('sender')
    return sender if isinstance(sender, str) else None


def extract_message_type(event: JsonDict) -> Optional[str]:
    """Extract messageType from an event."""
    data = event.get('data') or {}
    message_type = data.get('messageType')
    return message_type if isinstance(message_type, str) else None
