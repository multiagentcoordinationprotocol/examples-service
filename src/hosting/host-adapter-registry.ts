import { Injectable, Logger } from '@nestjs/common';
import { AgentHostAdapter } from './contracts/host-adapter.types';
import { AgentFramework } from './contracts/manifest.types';
import { LangGraphHostAdapter } from './adapters/langgraph-host-adapter';
import { LangChainHostAdapter } from './adapters/langchain-host-adapter';
import { CrewAIHostAdapter } from './adapters/crewai-host-adapter';
import { CustomHostAdapter } from './adapters/custom-host-adapter';

@Injectable()
export class HostAdapterRegistry {
  private readonly logger = new Logger(HostAdapterRegistry.name);
  private readonly adapters = new Map<AgentFramework, AgentHostAdapter>();

  constructor() {
    this.register(new LangGraphHostAdapter());
    this.register(new LangChainHostAdapter());
    this.register(new CrewAIHostAdapter());
    this.register(new CustomHostAdapter());
    this.logger.log(`registered host adapters: ${Array.from(this.adapters.keys()).join(', ')}`);
  }

  register(adapter: AgentHostAdapter): void {
    this.adapters.set(adapter.framework, adapter);
  }

  get(framework: AgentFramework): AgentHostAdapter | undefined {
    return this.adapters.get(framework);
  }

  getOrThrow(framework: AgentFramework): AgentHostAdapter {
    const adapter = this.adapters.get(framework);
    if (!adapter) {
      throw new Error(`no host adapter registered for framework: ${framework}`);
    }
    return adapter;
  }

  list(): AgentFramework[] {
    return Array.from(this.adapters.keys());
  }

  has(framework: AgentFramework): boolean {
    return this.adapters.has(framework);
  }
}
