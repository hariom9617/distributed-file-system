# Storage Node — Milestone 1

A standalone TypeScript service that stores binary chunks on the local filesystem.
Part of the distributed file storage system project.

---

## Requirements

- Node.js ≥ 18
- npm ≥ 9

---

## Setup

```bash
cd storage-node
npm install
cp .env.example .env   # edit as needed
```

---

## Running

### Development (auto-reload)

```bash
npm run dev
```

### Production build

```bash
npm run build
npm start
```

---

## Configuration

All configuration is via environment variables (`.env` file is supported).

| Variable       | Default          | Description                                              |
|----------------|------------------|----------------------------------------------------------|
| `NODE_ID`      | `node-1`         | Unique identity for this node (alphanumeric, `-`, `_`)   |
| `PORT`         | `3001`           | HTTP port the server listens on                          |
| `STORAGE_PATH` | `./data/chunks`  | Directory where chunk files are kept                     |
| `LOG_LEVEL`    | `info`           | Pino log level                                           |

### Running multiple nodes locally

The same binary can represent any number of independent storage nodes.
Each instance needs a unique `NODE_ID`, `PORT`, and `STORAGE_PATH`:

```bash
# Terminal 1 — node-1
NODE_ID=node-1 PORT=3001 STORAGE_PATH=./data/node-1 npm start

# Terminal 2 — node-2
NODE_ID=node-2 PORT=3002 STORAGE_PATH=./data/node-2 npm start

# Terminal 3 — node-3
NODE_ID=node-3 PORT=3003 STORAGE_PATH=./data/node-3 npm start
```

Each node's `GET /health` response will include its own `nodeId`:

```json
{ "status": "ok", "nodeId": "node-2", "uptime": 14.3, ... }
```

---

## API

### `POST /chunks`

Upload a chunk.  The chunk ID must be supplied as:
- Query param: `?chunkId=<id>`, **or**
- Header: `x-chunk-id: <id>`

Chunk IDs may only contain alphanumeric characters, hyphens (`-`), and
underscores (`_`), up to 128 characters.

**Request**

```
POST /chunks?chunkId=abc123
Content-Type: application/octet-stream

<raw binary body>
```

**Response `201`**

```json
{
  "chunkId": "abc123",
  "size": 1024,
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "storedAt": "2025-01-01T00:00:00.000Z"
}
```

---

### `GET /chunks/:chunkId`

Download a chunk.  The response body is the raw binary content, streamed.

**Response headers**

| Header             | Description              |
|--------------------|--------------------------|
| `x-chunk-id`       | The chunk ID             |
| `x-chunk-sha256`   | Stored SHA-256 digest    |
| `x-chunk-size`     | Size in bytes            |
| `Content-Length`   | Size in bytes            |
| `Content-Type`     | `application/octet-stream` |

**Status codes**

| Code | Meaning                      |
|------|------------------------------|
| 200  | Chunk found, body streamed   |
| 400  | Invalid chunk ID             |
| 404  | Chunk not found              |

---

### `HEAD /chunks/:chunkId`

Check if a chunk exists and retrieve its metadata headers.
Same headers as `GET`, no response body.

---

### `DELETE /chunks/:chunkId`

Delete a chunk.

**Response `200`**

```json
{ "deleted": "abc123" }
```

---

### `GET /health`

Returns node health information.

**Response `200`**

```json
{
  "status": "ok",
  "nodeId": "node-1",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "uptime": 42.3,
  "storage": { "chunkCount": 5, "totalBytes": 10240 },
  "process": { "pid": 1234, "memoryMB": 48, "platform": "linux", "nodeVersion": "v20.0.0" },
  "system":  { "hostname": "node-1", "cpus": 4, "loadAvg": [0.1, 0.2, 0.3], "freeMB": 1024, "totalMB": 8192 }
}
```

---

## Security

- Chunk IDs are validated against a strict allowlist (`[a-zA-Z0-9_-]{1,128}`) before any filesystem access.
- Path separators (`.`, `/`, `\`) and any other special characters in a chunk ID are rejected with `400 Bad Request`.
- This prevents path traversal attacks entirely.

---

## Testing

```bash
npm test
```

Tests use Vitest with Fastify's `inject()` method — no real HTTP port is bound.
Each test suite creates an isolated temporary directory and cleans up afterwards.

---

## Project Milestones

| Milestone | Status   | Description                                    |
|-----------|----------|------------------------------------------------|
| 1         | ✅ Done   | Single storage node with chunk CRUD + health   |
| 2         | ✅ Done   | Dockerize the storage node                     |
| 3A        | ✅ Done   | Configurable node identity (NODE_ID)           |
| 3B        | Planned  | Metadata service + chunk splitting             |
| 4         | Planned  | Multiple nodes + replication                   |
| 5         | Planned  | Heartbeat, failure detection, re-replication   |
| 6         | Planned  | Load-aware placement + rebalancer              |
| 7         | Planned  | Raft-based HA metadata                         |
| 8         | Planned  | Erasure coding                                 |
