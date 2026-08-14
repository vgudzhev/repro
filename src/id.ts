import { randomBytes } from "node:crypto";

export function generateTraceId(): string {
  return "r-" + randomBytes(3).toString("hex");
}
