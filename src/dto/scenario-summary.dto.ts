import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ScenarioSummaryDto {
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
}
