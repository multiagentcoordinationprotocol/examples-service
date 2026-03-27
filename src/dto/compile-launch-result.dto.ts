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
  executionRequest!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  display!: Record<string, unknown>;

  @ApiProperty({ type: [ParticipantBindingDto] })
  participantBindings!: ParticipantBindingDto[];
}
