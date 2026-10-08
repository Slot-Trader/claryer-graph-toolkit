export class GraphContextError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Conversation input failed validation. `issues` lists each problem. */
export class ValidationError extends GraphContextError {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(`${message}:\n  - ${issues.join('\n  - ')}`);
  }
}

export class NotFoundError extends GraphContextError {}

/** An LLM provider request failed (network, HTTP status, or malformed response). */
export class ProviderError extends GraphContextError {
  constructor(
    message: string,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** The LLM responded, but its output could not be parsed into an AnalysisResult. */
export class AnalysisParseError extends GraphContextError {
  constructor(
    message: string,
    public readonly rawOutput: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class NotImplementedError extends GraphContextError {}
