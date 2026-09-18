/**
 * How large a single uploaded photo may be.
 *
 * Shared by the server (which enforces it) and the Dropzone (which checks before spending
 * minutes sending a file that will be refused). No imports, so either side can use it.
 *
 * `BODY_SIZE_LIMIT` on the container must stay comfortably *above* this. adapter-node
 * rejects an oversized body itself, before any of our code runs, and answers with a bare
 * 413 that carries no JSON -- so if that limit is the lower of the two, every refusal
 * arrives as an unexplained failure instead of "that photo is too large".
 */
export const MAX_UPLOAD_MB = 25;

/** The same limit in bytes, decimal MB to match how the image pipeline measures. */
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1_000_000;
