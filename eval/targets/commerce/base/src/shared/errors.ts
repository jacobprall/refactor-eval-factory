export type CommerceErrorCode = "invalid_input" | "not_found" | "conflict" | "invalid_state";

export class CommerceError extends Error {
  readonly code: CommerceErrorCode;

  constructor(code: CommerceErrorCode, message: string) {
    super(message);
    this.name = "CommerceError";
    this.code = code;
  }
}

export function fail(code: CommerceErrorCode, message: string): never {
  throw new CommerceError(code, message);
}
