import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PackSummaryDto {
  @ApiProperty({ example: 'fraud' })
  slug!: string;

  @ApiProperty({ example: 'Fraud' })
  name!: string;

  @ApiPropertyOptional({ example: 'Fraud and risk decisioning demos' })
  description?: string;

  @ApiPropertyOptional({ example: ['fraud', 'risk', 'demo'] })
  tags?: string[];
}
