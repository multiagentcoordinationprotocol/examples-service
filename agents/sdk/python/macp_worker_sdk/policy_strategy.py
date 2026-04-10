"""Policy-aware decision strategy for coordinator agents."""

import math
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from macp_worker_sdk.bootstrap import PolicyHints

JsonDict = Dict[str, Any]


@dataclass
class SpecialistSignal:
    participant_id: str
    message_type: str  # 'Evaluation' | 'Objection'
    recommendation: str = ''
    confidence: float = 0.0
    severity: str = ''
    reason: str = ''


@dataclass
class PolicyDecision:
    action: str  # 'approve' | 'step_up' | 'decline'
    vote: str  # 'approve' | 'reject'
    reason: str
    policy_applied: str


class PolicyStrategy:
    """Applies policy-driven quorum and voting logic to specialist signals."""

    def __init__(self, hints: Optional[PolicyHints] = None) -> None:
        self.type = hints.type if hints else 'none'
        self.threshold = hints.threshold if hints else 0.5
        self.veto_enabled = (
            hints.veto_enabled if hints and hints.veto_enabled is not None
            else (hints.critical_severity_vetoes if hints and hasattr(hints, 'critical_severity_vetoes') else False)
        ) if hints else False
        self.veto_threshold = hints.veto_threshold if hints else 1
        self.minimum_confidence = hints.minimum_confidence if hints else 0.0

    def is_quorum_met(self, signals: Dict[str, SpecialistSignal], total_expected: int) -> bool:
        if self.type == 'unanimous':
            return len(signals) >= total_expected
        if self.type == 'none':
            return len(signals) > 0
        return len(signals) >= max(1, math.ceil(total_expected * self.threshold))

    def decide(self, signals: Dict[str, SpecialistSignal], session_context: JsonDict) -> PolicyDecision:
        all_signals = list(signals.values())

        # 1. Check for veto-blocking objections — critical severity only (RFC-MACP-0004)
        if self.veto_enabled:
            blocking = [
                s for s in all_signals
                if s.message_type == 'Objection' and s.severity == 'critical'
            ]
            if len(blocking) >= self.veto_threshold:
                return PolicyDecision(
                    action='decline',
                    vote='reject',
                    reason=f'policy {self.type}: {len(blocking)} critical objection(s) met veto threshold of {self.veto_threshold}',
                    policy_applied=self.type,
                )

        # 2. Filter evaluations by minimum_confidence (RFC-MACP-0012)
        qualified_evals = [
            s for s in all_signals
            if s.message_type == 'Evaluation' and (s.confidence if s.confidence else 1.0) >= self.minimum_confidence
        ]
        disqualified_count = sum(
            1 for s in all_signals
            if s.message_type == 'Evaluation' and (s.confidence if s.confidence else 1.0) < self.minimum_confidence
        )

        approvals = sum(
            1 for s in qualified_evals
            if s.recommendation.upper() == 'APPROVE'
        )
        rejections = sum(
            1 for s in qualified_evals
            if s.recommendation.upper() in ('BLOCK', 'REJECT')
        )
        objections = sum(1 for s in all_signals if s.message_type == 'Objection')
        total = len(signals)

        # Exclude ABSTAIN votes from voting ratio denominator
        abstain_count = sum(1 for s in qualified_evals if s.recommendation.upper() == 'ABSTAIN')
        effective_total = total - abstain_count

        # 3. Apply voting algorithm
        if self.type == 'unanimous':
            if rejections > 0 or objections > 0:
                return PolicyDecision(
                    action='decline',
                    vote='reject',
                    reason=f'policy unanimous: {rejections} rejection(s), {objections} objection(s)',
                    policy_applied='unanimous',
                )
            if disqualified_count > 0:
                return PolicyDecision(
                    action='step_up',
                    vote='approve',
                    reason=f'policy unanimous: {disqualified_count} evaluation(s) below minimum confidence {self.minimum_confidence}',
                    policy_applied='unanimous',
                )
            if approvals == total:
                return PolicyDecision(
                    action='approve',
                    vote='approve',
                    reason='policy unanimous: all participants approved',
                    policy_applied='unanimous',
                )
            return PolicyDecision(
                action='step_up',
                vote='approve',
                reason='policy unanimous: mixed signals, stepping up for additional review',
                policy_applied='unanimous',
            )

        approval_rate = approvals / effective_total if effective_total > 0 else 0.0

        if self.type in ('supermajority', 'majority'):
            if approval_rate >= self.threshold:
                return PolicyDecision(
                    action='approve',
                    vote='approve',
                    reason=f'policy {self.type}: {approval_rate * 100:.0f}% approval meets {self.threshold * 100:.0f}% threshold',
                    policy_applied=self.type,
                )
            if rejections + objections > approvals:
                return PolicyDecision(
                    action='decline',
                    vote='reject',
                    reason=f'policy {self.type}: majority rejected or objected',
                    policy_applied=self.type,
                )
            return PolicyDecision(
                action='step_up',
                vote='approve',
                reason=f'policy {self.type}: approval below {self.threshold * 100:.0f}% threshold, stepping up',
                policy_applied=self.type,
            )

        # 'none' — simple pass-through
        if rejections > 0 or objections > 0:
            return PolicyDecision(
                action='decline',
                vote='reject',
                reason='default policy: blocking signals observed',
                policy_applied='none',
            )
        return PolicyDecision(
            action='approve',
            vote='approve',
            reason='default policy: no blocking signals',
            policy_applied='none',
        )


def create_policy_strategy(hints: Optional[PolicyHints] = None) -> PolicyStrategy:
    """Factory: create a PolicyStrategy from policyHints."""
    return PolicyStrategy(hints)
