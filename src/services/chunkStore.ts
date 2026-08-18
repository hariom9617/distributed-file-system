import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

/**
 * Metadata returned when a chunk is successfully stored.
 */
export interface StoreResult {
  chunkId: string;
  size: number;
  sha256: string;
  storedAt: string; // ISO timestamp
}

/**
 * Metadata returned for HEAD/stat queries.
 */
export interface ChunkMeta {
  chunkId: string;
  size: number;
  sha256: string;
  createdAt: string; // ISO timestamp (file birthtime)
  modifiedAt: string; // ISO timestamp (file mtime)
}

/**
 * Thrown when a supplied chunk ID fails sanitization.
 */
export class InvalidChunkIdError extends Error {
  constructor(id: string) {
    super(`Invalid chunk ID: "${id}"`);
    this.name = "InvalidChunkIdError";
  }
}

/**
 * Thrown when a requested chunk does not exist.
 */
export class ChunkNotFoundError extends Error {
  constructor(id: string) {
    super(`Chunk not found: "${id}"`);
    this.name = "ChunkNotFoundError";
  }
}

/**
 * Allowed characters in a chunk ID.
 * Only alphanumeric, hyphens, and underscores are permitted.
 * This explicitly prevents path separators and dots, blocking path traversal.
 */
const VALID_CHUNK_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * ChunkStore manages storage of binary chunk files on the local filesystem.
 *
 * - All public methods validate the chunk ID before touching the filesystem.
 * - Writes are streamed; reads are streamed — large files are never fully
 *   buffered in memory by this class.
 * - A sidecar `.sha256` file is written alongside each chunk so that
 *   integrity can be verified without re-reading the whole file.
 */
export class ChunkStore {
  private readonly storagePath: string;

  constructor(storagePath: string) {
    this.storagePath = storagePath;
  }

  /** Ensure the storage directory exists. Call once at startup. */
  async init(): Promise<void> {
    await fsp.mkdir(this.storagePath, { recursive: true });
  }

  /**
   * Store a chunk from a Readable stream.
   * Streams the body to disk while computing SHA-256 on the fly.
   * Writes a sidecar hash file on success.
   */
  async store(chunkId: string, source: Readable): Promise<StoreResult> {
    this.validateId(chunkId);

    const chunkPath = this.chunkFilePath(chunkId);
    const hashPath = this.hashFilePath(chunkId);
    const hash = crypto.createHash("sha256");
    let size = 0;

    const writeStream = fs.createWriteStream(chunkPath);

    // Wrap source so we can intercept bytes for hashing / size counting.
    const countingTransform = new (require("stream").Transform)({
      transform(
        chunk: Buffer,
        _enc: string,
        cb: (err: Error | null, data: Buffer) => void
      ) {
        size += chunk.length;
        hash.update(chunk);
        cb(null, chunk);
      },
    });

    try {
      await pipeline(source, countingTransform, writeStream);
    } catch (err) {
      // Clean up partial file on error
      await fsp.unlink(chunkPath).catch(() => undefined);
      throw err;
    }

    const sha256 = hash.digest("hex");
    const storedAt = new Date().toISOString();

    // Write sidecar: "<sha256> <size> <storedAt>"
    await fsp.writeFile(hashPath, `${sha256} ${size} ${storedAt}`, "utf8");

    return { chunkId, size, sha256, storedAt };
  }

  /**
   * Open a readable stream for an existing chunk.
   * Callers are responsible for consuming / closing the stream.
   */
  async openReadStream(chunkId: string): Promise<fs.ReadStream> {
    this.validateId(chunkId);
    const chunkPath = this.chunkFilePath(chunkId);

    try {
      await fsp.access(chunkPath, fs.constants.R_OK);
    } catch {
      throw new ChunkNotFoundError(chunkId);
    }

    return fs.createReadStream(chunkPath);
  }

  /**
   * Return metadata for a chunk without reading its content.
   */
  async stat(chunkId: string): Promise<ChunkMeta> {
    this.validateId(chunkId);
    const chunkPath = this.chunkFilePath(chunkId);
    const hashPath = this.hashFilePath(chunkId);

    let fileStat: fsp.FileHandle | fs.Stats;
    try {
      fileStat = await fsp.stat(chunkPath);
    } catch {
      throw new ChunkNotFoundError(chunkId);
    }

    const stats = fileStat as fs.Stats;

    // Try to read the sidecar for the stored hash; fall back to empty string.
    let sha256 = "";
    try {
      const sidecar = await fsp.readFile(hashPath, "utf8");
      sha256 = sidecar.split(" ")[0] ?? "";
    } catch {
      // Sidecar missing — hash unknown
    }

    return {
      chunkId,
      size: stats.size,
      sha256,
      createdAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString(),
    };
  }

  /**
   * Delete a chunk and its sidecar hash file.
   */
  async delete(chunkId: string): Promise<void> {
    this.validateId(chunkId);
    const chunkPath = this.chunkFilePath(chunkId);
    const hashPath = this.hashFilePath(chunkId);

    try {
      await fsp.access(chunkPath);
    } catch {
      throw new ChunkNotFoundError(chunkId);
    }

    await fsp.unlink(chunkPath);
    await fsp.unlink(hashPath).catch(() => undefined); // sidecar may not exist
  }

  /**
   * Return the total number of stored chunks and aggregate disk usage.
   */
  async storageStats(): Promise<{ chunkCount: number; totalBytes: number }> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.storagePath);
    } catch {
      return { chunkCount: 0, totalBytes: 0 };
    }

    let chunkCount = 0;
    let totalBytes = 0;

    for (const entry of entries) {
      if (entry.endsWith(".sha256")) continue;
      const fullPath = path.join(this.storagePath, entry);
      try {
        const s = await fsp.stat(fullPath);
        if (s.isFile()) {
          chunkCount++;
          totalBytes += s.size;
        }
      } catch {
        // Race condition — file removed between readdir and stat
      }
    }

    return { chunkCount, totalBytes };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private validateId(chunkId: string): void {
    if (!VALID_CHUNK_ID_RE.test(chunkId)) {
      throw new InvalidChunkIdError(chunkId);
    }
  }

  private chunkFilePath(chunkId: string): string {
    return path.join(this.storagePath, chunkId);
  }

  private hashFilePath(chunkId: string): string {
    return path.join(this.storagePath, `${chunkId}.sha256`);
  }
}
