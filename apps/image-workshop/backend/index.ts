/**
 * Image Workshop MCP Server — tool logic and server creation.
 * Used by both stdio (src/stdio.ts) and Lambda HTTP (src/app.ts).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createBflClient } from "./bfl";
import { createCasfaBranchClient } from "./casfa-branch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const skillContent = readFileSync(
  resolve(__dirname, "skills", "flux-image-gen.md"),
  "utf-8"
);

export const fluxImageInputSchema = z.object({
  casfaBaseUrl: z
    .string()
    .url()
    .describe("Casfa server base URL (e.g. https://api.example.com or http://localhost:7100)."),
  branchAccessToken: z
    .string()
    .describe("Casfa branch access token (Bearer) for the target branch."),
  filename: z
    .string()
    .describe("Filename to save the generated image (e.g. output.png or images/hero.jpeg)."),
  prompt: z.string().describe("Text prompt for FLUX image generation."),
  width: z
    .number()
    .int()
    .min(64)
    .max(2048)
    .optional()
    .describe("Output width in pixels (multiple of 16). Default 1024."),
  height: z
    .number()
    .int()
    .min(64)
    .max(2048)
    .optional()
    .describe("Output height in pixels (multiple of 16). Default 1024."),
  seed: z.number().int().optional().describe("Seed for reproducible results."),
  safety_tolerance: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe("Moderation level 0 (strict) to 5 (permissive). Default 2."),
  output_format: z.enum(["jpeg", "png"]).optional().describe("Output format. Default jpeg."),
});

export type FluxImageArgs = z.infer<typeof fluxImageInputSchema>;

function contentTypeForFormat(format: "jpeg" | "png"): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

export async function handleFluxImage(
  args: FluxImageArgs
): Promise<{ path: string; key: string; completed: string }> {
  const bfl = createBflClient();
  const casfa = createCasfaBranchClient({ baseUrl: args.casfaBaseUrl });

  const imageBytes = await bfl.generateImage({
    prompt: args.prompt,
    width: args.width,
    height: args.height,
    seed: args.seed,
    safety_tolerance: args.safety_tolerance,
    output_format: args.output_format,
  });

  const format = args.output_format ?? "jpeg";
  const uploadResult = await casfa.uploadFile(
    args.branchAccessToken,
    args.filename,
    imageBytes,
    contentTypeForFormat(format)
  );

  const completeResult = await casfa.completeBranch(args.branchAccessToken);

  return {
    path: uploadResult.path,
    key: uploadResult.key,
    completed: completeResult.completed,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    {
      name: "image-workshop",
      version: "0.1.0",
    },
    {}
  );

  server.registerResource(
    "FLUX Image Generation",
    "skill://flux-image-gen",
    {
      description: "Skill definition for FLUX image generation",
      mimeType: "text/markdown",
      annotations: { audience: ["assistant"], priority: 1 },
    },
    async () => ({
      contents: [
        {
          uri: "skill://flux-image-gen",
          mimeType: "text/markdown",
          text: skillContent,
        },
      ],
    })
  );

  server.registerTool(
    "flux_image",
    {
      description:
        "Generate an image from a text prompt using BFL FLUX, upload the result to the given Casfa branch as the specified filename, then complete the branch (merge back to parent). Requires BFL_API_KEY in env. casfaBaseUrl is the Casfa server base URL (tool parameter).",
      inputSchema: fluxImageInputSchema,
    },
    async (args: FluxImageArgs) => {
      try {
        const result = await handleFluxImage(args);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  path: result.path,
                  key: result.key,
                  completed: result.completed,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ success: false, error: message }) },
          ],
          isError: true,
        };
      }
    }
  );

  return server;
}
