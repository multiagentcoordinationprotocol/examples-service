import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LaunchSummaryDto {
  @ApiProperty({ example: 'macp.mode.decision.v1' })
  modeName!: string;

  @ApiProperty({ example: '1.0.0' })
  modeVersion!: string;

  @ApiProperty({ example: 'config.default' })
  configurationVersion!: string;

  @ApiPropertyOptional({ example: 'policy.default' })
  policyVersion?: string;

  @ApiProperty({ example: 300000 })
  ttlMs!: number;

  @ApiPropertyOptional({ example: 'risk-agent' })
  initiatorParticipantId?: string;
}

export class RuntimeDto {
  @ApiProperty({ example: 'rust' })
  kind!: string;

  @ApiPropertyOptional({ example: 'v1' })
  version?: string;
}

export class ParticipantDto {
  @ApiProperty({ example: 'fraud-agent' })
  id!: string;

  @ApiProperty({ example: 'fraud' })
  role!: string;

  @ApiProperty({ example: 'fraud-agent' })
  agentRef!: string;
}

export class AgentPreviewDto {
  @ApiProperty({ example: 'fraud-agent' })
  agentRef!: string;

  @ApiProperty({ example: 'Fraud Agent' })
  name!: string;

  @ApiProperty({ example: 'fraud' })
  role!: string;

  @ApiProperty({ example: 'langgraph' })
  framework!: string;

  @ApiProperty({ example: 'agent://fraud-agent' })
  transportIdentity!: string;

  @ApiProperty({ example: 'examples/fraud/langgraph_fraud_agent.py:create_graph' })
  entrypoint!: string;

  @ApiProperty({ example: 'manifest-only' })
  bootstrapStrategy!: string;

  @ApiProperty({ example: 'deferred' })
  bootstrapMode!: string;

  @ApiPropertyOptional({ type: [String] })
  tags?: string[];
}

export class LaunchSchemaResponseDto {
  @ApiProperty({ example: 'fraud/high-value-new-device@1.0.0' })
  scenarioRef!: string;

  @ApiPropertyOptional({ example: 'default' })
  templateId?: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  formSchema!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  defaults!: Record<string, unknown>;

  @ApiProperty({ type: [ParticipantDto] })
  participants!: ParticipantDto[];

  @ApiProperty({ type: [AgentPreviewDto] })
  agents!: AgentPreviewDto[];

  @ApiProperty({ type: RuntimeDto })
  runtime!: RuntimeDto;

  @ApiProperty({ type: LaunchSummaryDto })
  launchSummary!: LaunchSummaryDto;

  @ApiPropertyOptional({ example: ['approve', 'step_up', 'decline'] })
  expectedDecisionKinds?: string[];
}
