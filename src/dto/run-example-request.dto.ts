import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { CompileLaunchRequestDto } from './compile-launch-request.dto';

export class RunExampleRequestDto extends CompileLaunchRequestDto {
  @ApiPropertyOptional({ default: true, description: 'Resolve and bootstrap example agent bindings before launch.' })
  @IsOptional()
  @IsBoolean()
  bootstrapAgents?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Submit the compiled execution request to the control plane.' })
  @IsOptional()
  @IsBoolean()
  submitToControlPlane?: boolean;

  @ApiPropertyOptional({
    type: [String],
    description: 'Additional tags to merge into execution.tags.',
    example: ['ui-launch', 'experiment-42']
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Override the execution requester.',
    example: { actorId: 'user@example.com', actorType: 'user' }
  })
  @IsOptional()
  @IsObject()
  requester?: { actorId?: string; actorType?: 'user' | 'service' | 'system' };

  @ApiPropertyOptional({
    description: 'Human-readable label stored in session metadata.',
    example: 'My test run'
  })
  @IsOptional()
  @IsString()
  runLabel?: string;
}
