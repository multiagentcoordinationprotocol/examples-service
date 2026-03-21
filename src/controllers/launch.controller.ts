import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { CompilerService } from '../launch/compiler.service';
import { LaunchService } from '../launch/launch.service';
import { CompileLaunchResult } from '../contracts/launch';
import { CompileLaunchRequestDto } from '../dto/compile-launch-request.dto';
import { CompileLaunchResultDto } from '../dto/compile-launch-result.dto';
import { LaunchSchemaResponseDto } from '../dto/launch-schema-response.dto';

@ApiTags('launch')
@Controller()
export class LaunchController {
  constructor(
    private readonly launchService: LaunchService,
    private readonly compilerService: CompilerService
  ) {}

  @Get('packs/:packSlug/scenarios/:scenarioSlug/versions/:version/launch-schema')
  @ApiOperation({ summary: 'Get launch schema and defaults for a scenario version.' })
  @ApiParam({ name: 'packSlug', description: 'Pack identifier' })
  @ApiParam({ name: 'scenarioSlug', description: 'Scenario identifier' })
  @ApiParam({ name: 'version', description: 'Scenario version' })
  @ApiQuery({ name: 'template', required: false, description: 'Template slug (default: none)' })
  @ApiOkResponse({ description: 'Launch schema with defaults', type: LaunchSchemaResponseDto })
  @ApiNotFoundResponse({ description: 'Scenario, version, or template not found' })
  async getLaunchSchema(
    @Param('packSlug') packSlug: string,
    @Param('scenarioSlug') scenarioSlug: string,
    @Param('version') version: string,
    @Query('template') template?: string
  ): Promise<LaunchSchemaResponseDto> {
    return this.launchService.getLaunchSchema(packSlug, scenarioSlug, version, template);
  }

  @Post('launch/compile')
  @ApiOperation({ summary: 'Validate and compile inputs into an ExecutionRequest.' })
  @ApiBody({ type: CompileLaunchRequestDto })
  @ApiOkResponse({ description: 'Compiled execution request', type: CompileLaunchResultDto })
  @ApiBadRequestResponse({ description: 'Validation failed or invalid scenario ref' })
  @ApiNotFoundResponse({ description: 'Scenario, version, or template not found' })
  async compile(@Body() body: CompileLaunchRequestDto): Promise<CompileLaunchResult> {
    return this.compilerService.compile(body);
  }
}
