import { ApiProperty } from '@nestjs/swagger';

class ParticipantBindingDto {
  @ApiProperty()
  participantId!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  agentRef!: string;
}

export class CompileLaunchResultDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  runDescriptor!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  initiator?: Record<string, unknown>;

  @ApiProperty()
  sessionId!: string;

  @ApiProperty({ enum: ['live', 'sandbox'] })
  mode!: 'live' | 'sandbox';

  @ApiProperty({ type: 'object', additionalProperties: true })
  scenarioMeta!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  display!: Record<string, unknown>;

  @ApiProperty({ type: [ParticipantBindingDto] })
  participantBindings!: ParticipantBindingDto[];
}
