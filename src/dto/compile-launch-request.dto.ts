import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class CompileLaunchRequestDto {
  @ApiProperty({ example: 'fraud/high-value-new-device@1.0.0' })
  @IsString()
  @IsNotEmpty()
  scenarioRef!: string;

  @ApiPropertyOptional({ example: 'default' })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({ enum: ['live', 'sandbox'], default: 'sandbox' })
  @IsOptional()
  @IsIn(['live', 'sandbox'])
  mode?: 'live' | 'sandbox';

  @ApiProperty({ type: 'object', additionalProperties: true, example: { transactionAmount: 3200, deviceTrustScore: 0.12, accountAgeDays: 5, isVipCustomer: true, priorChargebacks: 1 } })
  @IsObject()
  inputs!: Record<string, unknown>;
}
