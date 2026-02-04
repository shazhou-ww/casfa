import { createHash } from "node:crypto";
import { EMPTY_DICT_BYTES } from "../src/well-known.ts";

console.log("Empty dict bytes (hex):");
console.log(Buffer.from(EMPTY_DICT_BYTES).toString("hex"));

console.log("\nBytes breakdown:");
const view = new DataView(EMPTY_DICT_BYTES.buffer);
console.log("  magic:", `0x${view.getUint32(0, true).toString(16)}`);
console.log("  flags:", `0b${view.getUint32(4, true).toString(2)}`);
console.log("  size:", view.getBigUint64(8, true).toString());
console.log("  count:", view.getUint32(16, true));
console.log("  length:", view.getUint32(20, true));
console.log("  reserved:", view.getUint32(24, true), view.getUint32(28, true));

const hash = createHash("sha256").update(EMPTY_DICT_BYTES).digest("hex");
console.log("\nSHA-256 hash:");
console.log(`sha256:${hash}`);
