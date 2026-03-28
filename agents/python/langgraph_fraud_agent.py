#!/usr/bin/env python3
import time

from worker_common import (
    AgentRuntimeContext,
    ControlPlaneClient,
    build_proto_envelope,
    extract_proposal_id,
    log,
    specialist_recipients,
    terminal,
)


def recommendation_for_context(context: AgentRuntimeContext):
    trust = float(context.session_context.get('deviceTrustScore', 0.0) or 0.0)
    chargebacks = int(context.session_context.get('priorChargebacks', 0) or 0)

    if trust < 0.08 or chargebacks >= 2:
        return 'BLOCK', 0.94, 'device trust is critically low for this account history'
    if trust < 0.2 or chargebacks >= 1:
        return 'REVIEW', 0.84, 'device trust or chargeback history requires manual review'
    return 'APPROVE', 0.72, 'fraud signals are within the acceptable range for this session'


def main() -> int:
    client = ControlPlaneClient()
    context = AgentRuntimeContext()
    after_seq = 0
    responded = False
    deadline = time.time() + min(max((context.ttl_ms / 1000.0) + 15.0, 60.0), 420.0)

    log('fraud agent worker started', participantId=context.participant_id, framework=context.framework)

    while time.time() < deadline:
        run = client.get_run(context.run_id)
        if terminal(run):
            log('run reached terminal status; exiting fraud agent', status=run.get('status'))
            return 0

        for event in client.get_events(context.run_id, after_seq, 200):
            after_seq = max(after_seq, int(event.get('seq', 0) or 0))
            if event.get('type') != 'proposal.created' or responded:
                continue

            proposal_id = extract_proposal_id(event)
            if not proposal_id:
                continue

            recommendation, confidence, reason = recommendation_for_context(context)
            client.send_message(
                context.run_id,
                {
                    'from': context.participant_id,
                    'to': specialist_recipients(context),
                    'messageType': 'Evaluation',
                    'payloadEnvelope': build_proto_envelope(
                        'macp.modes.decision.v1.EvaluationPayload',
                        {
                            'proposal_id': proposal_id,
                            'recommendation': recommendation,
                            'confidence': confidence,
                            'reason': reason,
                        },
                    ),
                    'metadata': {
                        'framework': context.framework,
                        'agentRef': context.agent_ref,
                        'hostKind': 'python-process',
                    },
                },
            )
            log('fraud evaluation sent', proposalId=proposal_id, recommendation=recommendation)
            responded = True
            return 0

        time.sleep(0.75)

    log('fraud agent timed out without a proposal')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
