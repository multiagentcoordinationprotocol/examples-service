import { createPolicyStrategy, PolicyHints, SpecialistSignal } from './policy-strategy';

function signal(
  participantId: string,
  messageType: 'Evaluation' | 'Objection',
  overrides: Partial<SpecialistSignal> = {}
): SpecialistSignal {
  return { participantId, messageType, ...overrides };
}

function signalMap(...signals: SpecialistSignal[]): Map<string, SpecialistSignal> {
  return new Map(signals.map((s) => [s.participantId, s]));
}

describe('PolicyStrategy', () => {
  describe('createPolicyStrategy with no hints (default/none)', () => {
    const strategy = createPolicyStrategy(undefined);

    it('quorum met with at least 1 signal', () => {
      const signals = signalMap(signal('a', 'Evaluation', { recommendation: 'APPROVE' }));
      expect(strategy.isQuorumMet(signals, 3)).toBe(true);
    });

    it('quorum not met with 0 signals', () => {
      expect(strategy.isQuorumMet(new Map(), 3)).toBe(false);
    });

    it('approves when no blocking signals', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
      expect(decision.vote).toBe('approve');
      expect(decision.policyApplied).toBe('none');
    });

    it('declines when blocking signals present', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'BLOCK' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
      expect(decision.vote).toBe('reject');
    });

    it('declines on any objection', () => {
      const signals = signalMap(signal('a', 'Objection', { severity: 'low', reason: 'concern' }));
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
    });
  });

  describe('createPolicyStrategy with majority hints', () => {
    const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: false };
    const strategy = createPolicyStrategy(hints);

    it('quorum requires at least ceil(total * threshold) signals', () => {
      expect(strategy.isQuorumMet(signalMap(signal('a', 'Evaluation')), 3)).toBe(false);
      expect(strategy.isQuorumMet(signalMap(signal('a', 'Evaluation'), signal('b', 'Evaluation')), 3)).toBe(true);
    });

    it('approves when approval rate meets threshold', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'REVIEW' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
      expect(decision.reason).toContain('67%');
      expect(decision.policyApplied).toBe('majority');
    });

    it('steps up when approval below threshold', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'REVIEW' }),
        signal('c', 'Evaluation', { recommendation: 'REVIEW' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('step_up');
    });

    it('declines when majority rejected', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'BLOCK' }),
        signal('b', 'Evaluation', { recommendation: 'BLOCK' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
    });

    it('does not veto when vetoEnabled is false', () => {
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'concern' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      // With veto disabled, objections count as non-approvals but don't auto-decline
      expect(decision.policyApplied).toBe('majority');
    });
  });

  describe('createPolicyStrategy with majority-veto hints', () => {
    const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: true };
    const strategy = createPolicyStrategy(hints);

    it('declines immediately on high-severity objection when veto enabled', () => {
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'compliance violation' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
      expect(decision.vote).toBe('reject');
      expect(decision.reason).toContain('veto threshold');
    });

    it('does not veto on low-severity objection', () => {
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'low', reason: 'minor concern' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      // Low severity doesn't trigger veto, so majority logic applies
      expect(decision.policyApplied).toBe('majority');
    });
  });

  describe('createPolicyStrategy with supermajority hints', () => {
    const hints: PolicyHints = { type: 'supermajority', threshold: 0.67 };
    const strategy = createPolicyStrategy(hints);

    it('requires higher quorum (ceil(3 * 0.67) = 3)', () => {
      expect(strategy.isQuorumMet(signalMap(signal('a', 'Evaluation')), 3)).toBe(false);
      expect(strategy.isQuorumMet(signalMap(signal('a', 'Evaluation'), signal('b', 'Evaluation')), 3)).toBe(false);
      expect(
        strategy.isQuorumMet(
          signalMap(signal('a', 'Evaluation'), signal('b', 'Evaluation'), signal('c', 'Evaluation')),
          3
        )
      ).toBe(true);
    });

    it('approves when approval rate meets 67% threshold (3/4 = 75%)', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('d', 'Evaluation', { recommendation: 'REVIEW' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
      expect(decision.reason).toContain('75%');
    });

    it('steps up when just below threshold', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'REVIEW' }),
        signal('c', 'Evaluation', { recommendation: 'REVIEW' }),
        signal('d', 'Evaluation', { recommendation: 'REVIEW' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('step_up');
    });
  });

  describe('createPolicyStrategy with unanimous hints', () => {
    const hints: PolicyHints = { type: 'unanimous', threshold: 1.0, vetoEnabled: true };
    const strategy = createPolicyStrategy(hints);

    it('requires all specialists for quorum', () => {
      expect(strategy.isQuorumMet(signalMap(signal('a', 'Evaluation'), signal('b', 'Evaluation')), 3)).toBe(false);
      expect(
        strategy.isQuorumMet(
          signalMap(signal('a', 'Evaluation'), signal('b', 'Evaluation'), signal('c', 'Evaluation')),
          3
        )
      ).toBe(true);
    });

    it('approves when all approve', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
      expect(decision.policyApplied).toBe('unanimous');
    });

    it('declines on any rejection', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'BLOCK' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
      expect(decision.vote).toBe('reject');
      expect(decision.reason).toContain('unanimous');
    });

    it('declines on any objection', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Objection', { severity: 'high', reason: 'concern' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
    });

    it('steps up on mixed non-blocking signals', () => {
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'REVIEW' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('step_up');
    });
  });

  describe('RFC-MACP-0012: vetoThreshold', () => {
    it('does not veto when blocking objections are below veto threshold', () => {
      const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: true, vetoThreshold: 2 };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'compliance issue' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      // Only 1 blocking objection, but threshold is 2 — no veto
      expect(decision.action).toBe('approve');
      expect(decision.policyApplied).toBe('majority');
    });

    it('vetoes when blocking objections meet veto threshold of 2', () => {
      const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: true, vetoThreshold: 2 };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'compliance issue' }),
        signal('b', 'Objection', { severity: 'critical', reason: 'fraud detected' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
      expect(decision.vote).toBe('reject');
      expect(decision.reason).toContain('veto threshold of 2');
    });

    it('defaults vetoThreshold to 1 when not specified', () => {
      const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: true };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'concern' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('decline');
      expect(decision.reason).toContain('veto threshold of 1');
    });

    it('only counts high/critical severity towards veto threshold', () => {
      const hints: PolicyHints = { type: 'majority', threshold: 0.5, vetoEnabled: true, vetoThreshold: 2 };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'major concern' }),
        signal('b', 'Objection', { severity: 'low', reason: 'minor concern' }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('d', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      // 1 high + 1 low = only 1 high counts toward veto threshold of 2, so no veto triggered
      // majority voting: 2 approvals out of 4 = 50% >= 50% threshold
      expect(decision.reason).not.toContain('veto threshold');
      expect(decision.action).toBe('approve');
    });
  });

  describe('RFC-MACP-0012: minimumConfidence', () => {
    it('filters evaluations below minimum confidence threshold', () => {
      const hints: PolicyHints = {
        type: 'unanimous',
        threshold: 1.0,
        minimumConfidence: 0.7
      };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.9 }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.5 }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.8 })
      );
      const decision = strategy.decide(signals, {});
      // b has confidence 0.5 < 0.7 threshold, disqualified -> step_up for unanimous
      expect(decision.action).toBe('step_up');
      expect(decision.reason).toContain('below minimum confidence');
    });

    it('approves when all evaluations meet minimum confidence', () => {
      const hints: PolicyHints = {
        type: 'unanimous',
        threshold: 1.0,
        minimumConfidence: 0.5
      };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.9 }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.7 }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.8 })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
    });

    it('treats evaluations without confidence as confidence 1.0 (qualified)', () => {
      const hints: PolicyHints = {
        type: 'majority',
        threshold: 0.5,
        minimumConfidence: 0.6
      };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      // No confidence set = defaults to 1.0, passes threshold
      expect(decision.action).toBe('approve');
    });

    it('defaults minimumConfidence to 0.0 (all evaluations qualify)', () => {
      const strategy = createPolicyStrategy({ type: 'majority', threshold: 0.5 });
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.01 }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.02 })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
    });

    it('disqualified low-confidence rejections do not count as rejections', () => {
      const hints: PolicyHints = {
        type: 'majority',
        threshold: 0.5,
        minimumConfidence: 0.7
      };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.9 }),
        signal('b', 'Evaluation', { recommendation: 'BLOCK', confidence: 0.3 }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.8 })
      );
      const decision = strategy.decide(signals, {});
      // b's BLOCK is below confidence threshold — not counted
      // 2 approvals out of 3 total signals = 67% >= 50% threshold
      expect(decision.action).toBe('approve');
    });
  });

  describe('RFC-MACP-0012: designatedRoles', () => {
    it('passes designatedRoles through PolicyHints', () => {
      const hints: PolicyHints = {
        type: 'majority',
        threshold: 0.5,
        designatedRoles: ['risk', 'compliance']
      };
      const strategy = createPolicyStrategy(hints);
      // designatedRoles is informational for commitment authority — strategy still works
      const signals = signalMap(
        signal('a', 'Evaluation', { recommendation: 'APPROVE' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE' })
      );
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
    });
  });

  describe('edge cases', () => {
    it('handles empty signals map (0 approvals → step_up)', () => {
      const strategy = createPolicyStrategy({ type: 'majority', threshold: 0.5 });
      const decision = strategy.decide(new Map(), {});
      expect(decision.action).toBe('step_up');
      expect(decision.policyApplied).toBe('majority');
    });

    it('handles single signal', () => {
      const strategy = createPolicyStrategy({ type: 'majority', threshold: 0.5 });
      const signals = signalMap(signal('a', 'Evaluation', { recommendation: 'APPROVE' }));
      const decision = strategy.decide(signals, {});
      expect(decision.action).toBe('approve');
    });

    it('combined vetoThreshold and minimumConfidence', () => {
      const hints: PolicyHints = {
        type: 'majority',
        threshold: 0.5,
        vetoEnabled: true,
        vetoThreshold: 2,
        minimumConfidence: 0.6
      };
      const strategy = createPolicyStrategy(hints);
      const signals = signalMap(
        signal('a', 'Objection', { severity: 'high', reason: 'concern' }),
        signal('b', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.9 }),
        signal('c', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.4 }),
        signal('d', 'Evaluation', { recommendation: 'APPROVE', confidence: 0.8 })
      );
      const decision = strategy.decide(signals, {});
      // 1 objection < vetoThreshold(2), so no veto
      // c is below minimumConfidence, so only b and d qualify as approvals
      // 2 qualified approvals out of 4 total = 50% >= 50% threshold
      expect(decision.action).toBe('approve');
    });
  });
});
