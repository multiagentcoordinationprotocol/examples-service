import { Injectable, Logger } from '@nestjs/common';
import { AgentManifest, ManifestValidationResult } from './contracts/manifest.types';
import { HostAdapterRegistry } from './host-adapter-registry';

@Injectable()
export class ManifestValidator {
  private readonly logger = new Logger(ManifestValidator.name);

  constructor(private readonly adapterRegistry: HostAdapterRegistry) {}

  validate(manifest: AgentManifest): ManifestValidationResult {
    const errors: string[] = [];

    if (!manifest.id) {
      errors.push('manifest.id is required');
    }
    if (!manifest.name) {
      errors.push('manifest.name is required');
    }
    if (!manifest.framework) {
      errors.push('manifest.framework is required');
    }
    if (!manifest.entrypoint) {
      errors.push('manifest.entrypoint is required');
    } else {
      if (!manifest.entrypoint.type) {
        errors.push('manifest.entrypoint.type is required');
      }
      if (!manifest.entrypoint.value) {
        errors.push('manifest.entrypoint.value is required');
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    const adapter = this.adapterRegistry.get(manifest.framework);
    if (!adapter) {
      errors.push(`unsupported framework: ${manifest.framework}`);
      return { valid: false, errors };
    }

    const adapterResult = adapter.validateManifest(manifest);
    if (!adapterResult.valid) {
      this.logger.warn(
        `manifest validation failed for ${manifest.id}: ${adapterResult.errors.join('; ')}`
      );
    }

    return adapterResult;
  }
}
