import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";


const ALLOWED_FIELDS = [
  "timestamp",
  "source",
  "eventName",
  "sessionId",
  "agentId",
  "actorKey",
  "toolName",
  "success",
  "hostEvent",
  "context",
];

export function createMetadataLogger({ directory }) {
  if (!directory) throw new TypeError("Metadata log directory is required");

  return {
    async append(event) {
      const record = {};
      for (const field of ALLOWED_FIELDS) {
        if (event[field] !== undefined) record[field] = event[field];
      }
      const parsedDate = new Date(record.timestamp || Date.now());
      const day = Number.isNaN(parsedDate.valueOf())
        ? new Date().toISOString().slice(0, 10)
        : parsedDate.toISOString().slice(0, 10);
      await mkdir(directory, { recursive: true });
      await appendFile(
        path.join(directory, `events-${day}.jsonl`),
        `${JSON.stringify(record)}\n`,
        "utf8",
      );
    },
  };
}

