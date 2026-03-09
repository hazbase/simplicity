export class SimplicitySdkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ToolchainError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("TOOLCHAIN_ERROR", message, details);
  }
}

export class CompilerError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("COMPILER_ERROR", message, details);
  }
}

export class ArtifactError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("ARTIFACT_ERROR", message, details);
  }
}

export class ExecutionError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("EXECUTION_ERROR", message, details);
  }
}

export class UtxoNotFoundError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("UTXO_NOT_FOUND", message, details);
  }
}

export class RelayerError extends SimplicitySdkError {
  constructor(message: string, details?: unknown, public readonly status?: number) {
    super("RELAYER_ERROR", message, details);
  }
}

export class UnsupportedFeatureError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("UNSUPPORTED_FEATURE", message, details);
  }
}

export class ValidationError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION_ERROR", message, details);
  }
}

export class PresetExecutionError extends SimplicitySdkError {
  constructor(message: string, details?: unknown) {
    super("PRESET_EXECUTION_UNSUPPORTED", message, details);
  }
}
