---
name: "FLUX Image Generation"
description: "Generate images from text prompts using BFL FLUX"
version: "1.0.0"
category: "image"
author: "casfa"
allowed-tools: ["flux_image"]
---

# FLUX Image Generation

Generate high-quality images from text prompts using the BFL FLUX model.

## Usage

Provide a text prompt describing the desired image. The tool will:
1. Generate the image via BFL FLUX API
2. Set the image as the branch root (override the branch root with the image)
3. Complete the branch (merge back to parent)

The branch must be created with a non-existent mountPath so it starts with a null root; then the image becomes the entire root content.

## Parameters

**Input**
- **casfaBranchUrl** (required): Casfa branch root URL (use `accessUrlPrefix` from `branch_create`). Single URL for branch access; no token needed.
- **prompt** (required): Text description of the desired image.
- **width** / **height** (optional): Output dimensions in pixels (64–2048, default 1024).
- **seed** (optional): Seed for reproducible results.
- **safety_tolerance** (optional): Moderation level 0–5 (default 2).
- **output_format** (optional): `"jpeg"` or `"png"` (default `"jpeg"`).

**Output (success)**
- **success**: `true`
- **completed**: Branch ID that was merged (image appears at that branch’s mountPath in the parent).
- **key**: CAS node key of the generated image.

**Output (error)**
- **success**: `false`
- **error**: Error message.
