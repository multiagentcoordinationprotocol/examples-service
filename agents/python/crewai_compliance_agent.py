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


def compliance_response(context: AgentRuntimeContext):
    trust = float(context.session_context.get('deviceTrustScore', 0.0) or 0.0)
    amount = float(context.session_context.get('transactionAmount', 0.0) or 0.0)
    account_age_days = int(context.session_context.get('accountAgeDays', 0) or 0)
    chargebacks = int(context.session_context.get('priorChargebacks', 0) or 0)

    if trust <= 0.08 or chargebacks >= 2 or (amount >= 3000 and account_age_days < 7):
        return {
            'messageType': 'Objection',
            'payloadEnvelope': build_proto_envelope(
                'macp.modes.decision.v1.ObjectionPayload',
                {
                    'proposal_id': '',
                    'reason': 'policy checks require additional verification before approval',
                    'severity': 'high',
                },
            ),
        }

    return {
        'messageType': 'Evaluation',
        'payloadEnvelope': build_proto_envelope(
            'macp.modes.decision.v1.EvaluationPayload',
            {
                'proposal_id': '',
                'recommendation': 'REVIEW',
                'confidence': 0.76,
                'reason': 'compliance checks pass with a step-up recommendation for documentation hygiene',
            },
        ),
    }


def main() -> int:
    client = ControlPlaneClient()
    context = AgentRuntimeContext()
    after_seq = 0
    responded = False
    deadline = time.time() + min(max((context.ttl_ms / 1000.0) + 15.0, 60.0), 420.0)

    log('compliance agent worker started', participantId=context.participant_id, framework=context.framework)

    while time.time() < deadline:
        run = client.get_run(context.run_id)
        if terminal(run):
            log('run reached terminal status; exiting compliance agent', status=run.get('status'))
            return 0

        for event in client.get_events(context.run_id, after_seq, 200):
            after_seq = max(after_seq, int(event.get('seq', 0) or 0))
            if event.get('type') != 'proposal.created' or responded:
                continue

            proposal_id = extract_proposal_id(event)
            if not proposal_id:
                continue

            response = compliance_response(context)
            response['payloadEnvelope']['proto']['value']['proposal_id'] = proposal_id
            client.send_message(
                context.run_id,
                {
                    'from': context.participant_id,
                    'to': specialist_recipients(context),
                    'messageType': response['messageType'],
                    'payloadEnvelope': response['payloadEnvelope'],
                    'metadata': {
                        'framework': context.framework,
                        'agentRef': context.agent_ref,
                        'hostKind': 'python-process',
                    },
                },
            )
            log('compliance response sent', proposalId=proposal_id, messageType=response['messageType'])
            responded = True
            return 0

        time.sleep(0.75)

    log('compliance agent timed out without a proposal')
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
