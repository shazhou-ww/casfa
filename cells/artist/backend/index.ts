/**
 * Artist MCP Server — tool logic and server creation.
 * Uses @casfa/cell-mcp for HTTP MCP; stdio (if any) can still use the same handleFluxImage + schema.
 */
import { createCellMcpServer } from "@casfa/cell-mcp";
import type { Context } from "hono";
import { z } from "zod";
import { createBflClient } from "./bfl";
import { createCasfaBranchClient } from "./casfa-branch";
import { normalizeInputImagePath } from "./path-utils";
import fluxImageGenPrompt from "./prompts/flux-image-gen.md";

export const fluxImageInputSchema = z.object({
  casfaBranchUrl: z
    .string()
    .url()
    .describe(
      "Casfa branch root URL (accessUrlPrefix from branch_create). Single URL for branch-scoped requests; no token needed."
    ),
  prompt: z.string().describe("Text prompt for FLUX image generation."),
  outputPath: z
    .string()
    .transform((value, ctx) => parseInputImagePath(value, ctx))
    .describe("Relative file path in branch for generated output image."),
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

function parseCasfaBranchUrl(urlValue: string, ctx: z.RefinementCtx): string {
  try {
    const parsed = new URL(urlValue);
    if (parsed.search || parsed.hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "casfaBranchUrl must not contain query or hash",
      });
      return z.NEVER;
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Invalid casfaBranchUrl",
    });
    return z.NEVER;
  }
}

function parseInputImagePath(inputImagePath: string, ctx: z.RefinementCtx): string {
  try {
    return normalizeInputImagePath(inputImagePath);
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error instanceof Error ? error.message : "Invalid inputImagePath",
    });
    return z.NEVER;
  }
}

export const fluxImageEditInputSchema = z.object({
  casfaBranchUrl: z
    .string()
    .url()
    .transform((value, ctx) => parseCasfaBranchUrl(value, ctx))
    .describe(
      "Casfa branch root URL (accessUrlPrefix from branch_create). Single URL for branch-scoped requests; no token needed."
    ),
  inputImagePath: z
    .string()
    .transform((value, ctx) => parseInputImagePath(value, ctx))
    .describe("Relative file path in branch used as input image."),
  prompt: z.string().describe("Edit prompt for FLUX image edit."),
  outputPath: z
    .string()
    .transform((value, ctx) => parseInputImagePath(value, ctx))
    .describe("Relative file path in branch for edited output image."),
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

export type FluxImageEditArgs = z.infer<typeof fluxImageEditInputSchema>;

function contentTypeForFormat(format: "jpeg" | "png"): string {
  return format === "png" ? "image/png" : "image/jpeg";
}

export async function handleFluxImage(
  args: FluxImageArgs
): Promise<{ key: string; completed: string; path: string }> {
  const bfl = createBflClient();
  const casfa = createCasfaBranchClient({ branchRootUrl: args.casfaBranchUrl });

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
    args.outputPath,
    imageBytes,
    contentTypeForFormat(format)
  );

  const completeResult = await casfa.completeBranch();

  return {
    key: uploadResult.key,
    path: uploadResult.path,
    completed: completeResult.completed,
  };
}

export async function handleFluxImageEdit(
  args: FluxImageEditArgs
): Promise<{ key: string; completed: string; path: string }> {
  const bfl = createBflClient();
  const casfa = createCasfaBranchClient({ branchRootUrl: args.casfaBranchUrl });

  let inputImageUrl: string;
  try {
    inputImageUrl = await casfa.getRestrictedFileUrl(args.inputImagePath);
  } catch {
    inputImageUrl = casfa.getFileReadUrl(args.inputImagePath);
  }

  const imageBytes = await bfl.generateImageEdit({
    prompt: args.prompt,
    input_image: inputImageUrl,
    seed: args.seed,
    safety_tolerance: args.safety_tolerance,
    output_format: args.output_format,
  });

  const format = args.output_format ?? "jpeg";
  const uploadResult = await casfa.uploadFile(
    args.outputPath,
    imageBytes,
    contentTypeForFormat(format)
  );
  const completeResult = await casfa.completeBranch();

  return {
    key: uploadResult.key,
    path: uploadResult.path,
    completed: completeResult.completed,
  };
}

type Env = Record<string, unknown>;

/**
 * Create the Artist MCP route (POST /mcp).
 * Pass authCheck and onUnauthorized from your app so MCP is protected.
 */
export function createArtistMcpRoute(options: {
  authCheck?: (c: Context<Env>) => boolean | Promise<boolean>;
  onUnauthorized?: (c: Context<Env>) => Response;
}) {
  const cellMcp = createCellMcpServer({
    name: "artist",
    version: "0.1.0",
    authCheck: options.authCheck,
    onUnauthorized: options.onUnauthorized,
  });

  cellMcp.registerResource(
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

  cellMcp.registerPrompt("flux-image-gen", {
    description: "Generate images from text prompts using BFL FLUX",
  }, async () => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: fluxImageGenPrompt },
      },
    ],
  }));

  cellMcp.registerTool(
    "flux_image",
    {
      description:
        "Generate an image from a text prompt using BFL FLUX and write it to outputPath in the target Casfa branch, then complete the branch. Input: casfaBranchUrl, outputPath, prompt; optional width, height, seed, safety_tolerance, output_format. Output: success, completed, key, path.",
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
                  path: result.path,
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

  cellMcp.registerTool(
    "flux_image_edit",
    {
      description:
        "Edit an existing image from Casfa branch using BFL FLUX Kontext and write output to outputPath, then complete branch. Input: casfaBranchUrl, inputImagePath, outputPath, prompt, optional seed/safety_tolerance/output_format. Output: success, completed, key, path.",
      inputSchema: fluxImageEditInputSchema,
    },
    async (args: FluxImageEditArgs) => {
      try {
        const result = await handleFluxImageEdit(args);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  completed: result.completed,
                  key: result.key,
                  path: result.path,
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

  return cellMcp.getRoute();
}
