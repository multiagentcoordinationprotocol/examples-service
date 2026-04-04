import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AgentMetricsDto {
  @ApiProperty({ example: 0, description: 'Number of runs this agent has participated in.' })
  runs!: number;

  @ApiProperty({ example: 0, description: 'Number of signals this agent has sent.' })
  signals!: number;

  @ApiProperty({ example: 0, description: 'Average run duration in milliseconds.' })
  averageLatencyMs!: number;

  @ApiProperty({ example: 0, description: 'Reserved for future use.' })
  averageConfidence!: number;
}

export class AgentProfileDto {
  @ApiProperty({ example: 'fraud-agent' })
  agentRef!: string;

  @ApiProperty({ example: 'Fraud Agent' })
  name!: string;

  @ApiProperty({ example: 'fraud' })
  role!: string;

  @ApiProperty({ example: 'langgraph' })
  framework!: string;

  @ApiPropertyOptional({ example: 'Evaluates device, chargeback, and identity-risk signals.' })
  description?: string;

  @ApiProperty({ example: 'agent://fraud-agent' })
  transportIdentity!: string;

  @ApiProperty({ example: 'agents/langgraph_worker/main.py' })
  entrypoint!: string;

  @ApiProperty({ example: 'external' })
  bootstrapStrategy!: string;

  @ApiProperty({ example: 'attached' })
  bootstrapMode!: string;

  @ApiPropertyOptional({ type: [String], example: ['fraud', 'langgraph', 'risk'] })
  tags?: string[];

  @ApiProperty({
    type: [String],
    example: ['fraud/high-value-new-device@1.0.0', 'lending/loan-underwriting@1.0.0'],
    description: 'Scenario refs this agent participates in, computed from registry.'
  })
  scenarios!: string[];

  @ApiProperty({ type: AgentMetricsDto, description: 'Best-effort metrics from control plane.' })
  metrics!: AgentMetricsDto;
}
