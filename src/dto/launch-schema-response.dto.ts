import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LaunchSummaryDto {
  @ApiProperty({ example: 'macp.mode.deliberation.v1' })
  modeName!: string;

  @ApiProperty({ example: '1.0.0' })
  modeVersion!: string;

  @ApiProperty({ example: '1.0.0' })
  configurationVersion!: string;

  @ApiProperty({ example: 300000 })
  ttlMs!: number;
}

export class ParticipantDto {
  @ApiProperty({ example: 'fraud-agent' })
  id!: string;

  @ApiProperty({ example: 'fraud' })
  role!: string;

  @ApiProperty({ example: 'fraud-agent' })
  agentRef!: string;
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

  @ApiProperty({ type: LaunchSummaryDto })
  launchSummary!: LaunchSummaryDto;

  @ApiPropertyOptional({ example: ['approve', 'step_up', 'decline'] })
  expectedDecisionKinds?: string[];
}
