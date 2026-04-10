import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioSummaryDto {
  @ApiPropertyOptional({ example: 'fraud', description: 'Pack slug. Present in cross-pack listings.' })
  packSlug?: string;

  @ApiProperty({ example: 'high-value-new-device' })
  scenario!: string;

  @ApiProperty({ example: 'High Value Purchase From New Device' })
  name!: string;

  @ApiPropertyOptional({ example: 'Fraud Agent, Growth Agent, and Risk Agent discuss a transaction.' })
  summary?: string;

  @ApiProperty({ example: ['1.0.0'] })
  versions!: string[];

  @ApiProperty({ example: ['default', 'strict-risk'] })
  templates!: string[];

  @ApiPropertyOptional({ example: ['fraud', 'growth', 'risk'] })
  tags?: string[];

  @ApiPropertyOptional({ example: 'rust' })
  runtimeKind?: string;

  @ApiPropertyOptional({ example: ['fraud-agent', 'growth-agent', 'risk-agent'] })
  agentRefs?: string[];

  @ApiPropertyOptional({ example: 'policy.default' })
  policyVersion?: string;

  @ApiPropertyOptional({
    description: 'Governance policy hints aligned with RFC-MACP-0012 per-mode schemas',
    example: {
      type: 'none',
      description: 'Default policy — no additional governance constraints',
      vetoThreshold: 1,
      minimumConfidence: 0.0,
      designatedRoles: []
    }
  })
  policyHints?: {
    type?: string;
    description?: string;
    threshold?: number;
    vetoEnabled?: boolean;
    vetoRoles?: string[];
    vetoThreshold?: number;
    minimumConfidence?: number;
    designatedRoles?: string[];
  };
}
