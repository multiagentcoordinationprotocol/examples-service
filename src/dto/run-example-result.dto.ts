import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CompileLaunchResultDto } from './compile-launch-result.dto';

class HostedAgentDto {
  @ApiProperty()
  participantId!: string;

  @ApiProperty()
  agentRef!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty({ example: 'langgraph' })
  framework!: string;

  @ApiProperty()
  transportIdentity!: string;

  @ApiProperty()
  entrypoint!: string;

  @ApiProperty()
  bootstrapStrategy!: string;

  @ApiProperty()
  bootstrapMode!: string;

  @ApiProperty({ example: 'bootstrapped' })
  status!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  participantMetadata?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  notes?: string[];
}

class ControlPlaneLaunchDto {
  @ApiProperty()
  baseUrl!: string;

  @ApiProperty()
  validated!: boolean;

  @ApiProperty()
  submitted!: boolean;

  @ApiPropertyOptional()
  runId?: string;

  @ApiPropertyOptional()
  status?: string;

  @ApiPropertyOptional()
  traceId?: string;
}

export class RunExampleResultDto {
  @ApiProperty({ type: CompileLaunchResultDto })
  compiled!: CompileLaunchResultDto;

  @ApiProperty({ type: [HostedAgentDto] })
  hostedAgents!: HostedAgentDto[];

  @ApiPropertyOptional({ type: ControlPlaneLaunchDto })
  controlPlane?: ControlPlaneLaunchDto;
}
