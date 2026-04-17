/**
 * Thrown when an ingest handler encounters a known, user-actionable
 * problem (no transcript, unreachable URL, unparseable article, etc.).
 *
 * The route handler maps these to 422 with the message as the body,
 * as opposed to unexpected errors which become a generic 500.
 */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}
