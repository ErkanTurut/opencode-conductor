export interface AgentSpec {
  taskId: string
  runId: string
  objective: string
  role: string
  model: string
  variant?: string
  worktree: string
  allowedPaths: string[]
  acceptanceCriteria: string[]
  verificationCommands: string[]
  mustNot: string[]
}

export interface AgentSessionResult {
  sessionId: string
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  usage: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  } | null
  artifacts: string[]
  success: boolean
}

export interface IAgentAdapter {
  start(spec: AgentSpec): Promise<string>
  streamEvents(
    sessionId: string,
    onEvent: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ): Promise<AgentSessionResult>
  sendTurn(sessionId: string, input: string): Promise<void>
  answerPermission(sessionId: string, decision: string): Promise<void>
  answerQuestion(sessionId: string, answer: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  resume(sessionId: string): Promise<void>
  health(): Promise<{ available: boolean }>
  usage(sessionId: string): Promise<Record<string, unknown> | null>
}

export class OpenCodeCliAdapter implements IAgentAdapter {
  private sessions: Map<
    string,
    {
      process: ReturnType<typeof Bun.spawn>
      output: string[]
      errors: string[]
      startTime: number
    }
  >

  constructor() {
    this.sessions = new Map()
  }

  private executable(): string {
    return process.env.OPENCODE_BIN?.trim() || 'opencode2'
  }

  private buildPrompt(spec: AgentSpec): string {
    const lines: string[] = [
      '## Task Contract',
      '',
      `Task ID: ${spec.taskId}`,
      `Role: ${spec.role}`,
      `Objective: ${spec.objective}`,
      '',
      '### Acceptance Criteria',
      ...spec.acceptanceCriteria.map((c) => `- ${c}`),
      '',
    ]

    if (spec.allowedPaths.length) {
      lines.push(
        '### Allowed Paths',
        ...spec.allowedPaths.map((p) => `- ${p}`),
        '',
      )
    }

    if (spec.verificationCommands.length) {
      lines.push(
        '### Required Verification',
        'Run these commands before declaring completion:',
        ...spec.verificationCommands.map((c) => `- \`${c}\``),
        '',
      )
    }

    if (spec.mustNot.length) {
      lines.push('### Must Not', ...spec.mustNot.map((d) => `- ${d}`), '')
    }

    lines.push(
      '---',
      'Implement the changes described above. Run verification commands when done.',
    )

    return lines.join('\n')
  }

  async start(spec: AgentSpec): Promise<string> {
    const sessionId = `${spec.runId}-${spec.taskId}-${Date.now()}`
    const prompt = this.buildPrompt(spec)

    const model = spec.variant ? `${spec.model}#${spec.variant}` : spec.model
    const proc = Bun.spawn(
      [this.executable(), 'run', '--agent', spec.role, '--model', model, prompt],
      {
      cwd: spec.worktree,
      env: {
        ...process.env,
      },
      stdout: 'pipe',
      stderr: 'pipe',
      },
    )

    this.sessions.set(sessionId, {
      process: proc,
      output: [],
      errors: [],
      startTime: Date.now(),
    })

    return sessionId
  }

  async streamEvents(
    sessionId: string,
    onEvent: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ): Promise<AgentSessionResult> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)

    const { process: proc } = session
    const decoder = new TextDecoder()

    const readStream = async (
      stream: ReadableStream<Uint8Array> | number | null | undefined,
      buffer: string[],
    ) => {
      if (!stream || typeof stream === 'number') return
      const reader = stream.getReader()
      try {
        while (true) {
          if (signal.aborted) {
            reader.releaseLock()
            return
          }
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value)
          buffer.push(text)
          onEvent({ type: 'output', content: text, sessionId })
        }
      } finally {
        reader.releaseLock()
      }
    }

    const startTime = Date.now()
    await Promise.all([
      readStream(proc.stdout, session.output),
      readStream(proc.stderr, session.errors),
    ])

    const exitCode = await proc.exited
    const durationMs = Date.now() - startTime

    const allOutput = session.output.join('')
    const allErrors = session.errors.join('')

    let usage: AgentSessionResult['usage'] = null
    try {
      const jsonMatch = allOutput.match(
        /```json\n({[\s\S]*?"usage"[\s\S]*?})\n```/,
      )
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[1])
        usage = parsed.usage || null
      }
    } catch {
      // Usage extraction is best-effort
    }

    const success = exitCode === 0 && !signal.aborted

    return {
      sessionId,
      exitCode,
      stdout: allOutput,
      stderr: allErrors,
      durationMs,
      usage,
      artifacts: [],
      success,
    }
  }

  async sendTurn(_sessionId: string, _input: string): Promise<void> {
    // Not supported in CLI mode — restart with new context
  }

  async answerPermission(_sessionId: string, _decision: string): Promise<void> {
    // Not supported in CLI mode
  }

  async answerQuestion(_sessionId: string, _answer: string): Promise<void> {
    // Not supported in CLI mode
  }

  async interrupt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.kill('SIGTERM')
    }
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.process.kill('SIGKILL')
      this.sessions.delete(sessionId)
    }
  }

  async resume(_sessionId: string): Promise<void> {
    // CLI mode cannot resume — start a new session
  }

  async health(): Promise<{ available: boolean }> {
    try {
      const proc = Bun.spawn([this.executable(), '--version'], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const exitCode = await proc.exited
      return { available: exitCode === 0 }
    } catch {
      return { available: false }
    }
  }

  async usage(_sessionId: string): Promise<Record<string, unknown> | null> {
    // Not currently extractable from CLI output
    return null
  }
}
