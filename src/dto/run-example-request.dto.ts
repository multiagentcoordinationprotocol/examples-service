import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
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
}
