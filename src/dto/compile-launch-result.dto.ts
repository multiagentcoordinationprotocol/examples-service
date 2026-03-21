import { ApiProperty } from '@nestjs/swagger';

export class CompileLaunchResultDto {
  @ApiProperty({ type: 'object', additionalProperties: true })
  executionRequest!: Record<string, unknown>;

  @ApiProperty({ type: 'object', additionalProperties: true })
  display!: Record<string, unknown>;
}
