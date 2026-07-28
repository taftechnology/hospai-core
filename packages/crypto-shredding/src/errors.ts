export class KeyShreddedError extends Error {
  constructor(public readonly piiKeyId: string) {
    super(`PII key shredded: ${piiKeyId}`);
    this.name = 'KeyShreddedError';
  }
}

export class KeyNotFoundError extends Error {
  constructor(public readonly piiKeyId: string) {
    super(`PII key not found: ${piiKeyId}`);
    this.name = 'KeyNotFoundError';
  }
}
