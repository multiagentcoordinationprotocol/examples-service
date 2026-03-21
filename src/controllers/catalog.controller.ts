import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../catalog/catalog.service';
import { PackSummaryDto } from '../dto/pack-summary.dto';
import { ScenarioSummaryDto } from '../dto/scenario-summary.dto';

@ApiTags('catalog')
@Controller('packs')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List all available scenario packs.' })
  @ApiOkResponse({ description: 'Array of pack summaries', type: [PackSummaryDto] })
  async listPacks(): Promise<PackSummaryDto[]> {
    return this.catalogService.listPacks();
  }

  @Get(':packSlug/scenarios')
  @ApiOperation({ summary: 'List scenarios in a pack with versions and templates.' })
  @ApiParam({ name: 'packSlug', description: 'Pack identifier' })
  @ApiOkResponse({ description: 'Array of scenario summaries', type: [ScenarioSummaryDto] })
  @ApiNotFoundResponse({ description: 'Pack not found' })
  async listScenarios(@Param('packSlug') packSlug: string): Promise<ScenarioSummaryDto[]> {
    return this.catalogService.listScenarios(packSlug);
  }
}
