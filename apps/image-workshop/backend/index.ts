/**
 * Image Workshop MCP Server — tool logic and server creation.
 * Used by both stdio (src/stdio.ts) and Lambda HTTP (src/app.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createBflClient } from "./bfl";
import { createCasfaBranchClient } from "./casfa-branch";
import fluxImageGenPrompt from "./prompts/flux-image-gen.md";

export const fluxImageInputSchema = z.object({
  casfaBaseUrl: z
    .string()
    .url()
    .describe("Casfa server base URL (e.g. https://api.example.com or http://localhost:7100)."),
  branchAccessToken: z
    .string()
    .describe("Casfa branch access token (Bearer) for the target branch."),
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
): Promise<{ key: string; completed: string }> {
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
  const setRootResult = await casfa.setRootToFile(
    args.branchAccessToken,
    imageBytes,
    contentTypeForFormat(format)
  );

  const completeResult = await casfa.completeBranch(args.branchAccessToken);

  return {
    key: setRootResult.key,
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
    "prompt://flux-image-gen",
    {
      description: "Prompt template for FLUX image generation",
      mimeType: "text/markdown",
      annotations: { audience: ["assistant"], priority: 1 },
    },
    async () => ({
      contents: [
        {
          uri: "prompt://flux-image-gen",
          mimeType: "text/markdown",
          text: fluxImageGenPrompt,
        },
      ],
    })
  );

  server.registerPrompt("flux-image-gen", {
    description: "Generate images from text prompts using BFL FLUX",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: fluxImageGenPrompt },
      },
    ],
  }));

  server.registerTool(
    "flux_image",
    {
      description:
        "Generate an image from a text prompt using BFL FLUX, set it as the Casfa branch root (single file), then complete the branch (merge into parent at the branch's mountPath). Branch must be created with a non-existent mountPath (null root). Input: casfaBaseUrl (from branch_create.baseUrl), branchAccessToken (from branch_create.accessToken), prompt; optional width, height, seed, safety_tolerance, output_format. Output: success, completed (branchId merged), key (CAS node key of the image).",
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
                  completed: result.completed,
                  key: result.key,
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
