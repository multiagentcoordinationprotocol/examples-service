import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../catalog/catalog.service';
import { PackSummaryDto } from '../dto/pack-summary.dto';
import { ScenarioSummaryDto } from '../dto/scenario-summary.dto';

@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('packs')
  @ApiOperation({ summary: 'List all available scenario packs.' })
  @ApiOkResponse({ description: 'Array of pack summaries', type: [PackSummaryDto] })
  async listPacks(): Promise<PackSummaryDto[]> {
    return this.catalogService.listPacks();
  }

  @Get('packs/:packSlug/scenarios')
  @ApiOperation({ summary: 'List scenarios in a pack with versions and templates.' })
  @ApiParam({ name: 'packSlug', description: 'Pack identifier' })
  @ApiOkResponse({ description: 'Array of scenario summaries', type: [ScenarioSummaryDto] })
  @ApiNotFoundResponse({ description: 'Pack not found' })
  async listScenarios(@Param('packSlug') packSlug: string): Promise<ScenarioSummaryDto[]> {
    return this.catalogService.listScenarios(packSlug);
  }

  @Get('scenarios')
  @ApiOperation({ summary: 'List all scenarios across all packs.' })
  @ApiOkResponse({ description: 'Array of scenario summaries with packSlug', type: [ScenarioSummaryDto] })
  async listAllScenarios(): Promise<ScenarioSummaryDto[]> {
    return this.catalogService.listAllScenarios();
  }
}
