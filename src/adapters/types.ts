import type { IAgentAdapter } from './opencode-cli'

export interface AdapterFactory {
  create(): IAgentAdapter
}

export class OpenCodeAdapterFactory implements AdapterFactory {
  create(): IAgentAdapter {
    const { OpenCodeCliAdapter } = require('./opencode-cli')
    return new OpenCodeCliAdapter()
  }
}
