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
2. Write the generated image to the requested output path in the branch.

Branch lifecycle (create/transfer/close) is managed by gateway runtime, not this tool.

## Parameters

**Input**
- **casfaBranchUrl** (required): Casfa branch root URL injected by gateway runtime.
- **prompt** (required): Text description of the desired image.
- **width** / **height** (optional): Output dimensions in pixels (64–2048, default 1024).
- **seed** (optional): Seed for reproducible results.
- **safety_tolerance** (optional): Moderation level 0–5 (default 2).
- **output_format** (optional): `"jpeg"` or `"png"` (default `"jpeg"`).

**Output (success)**
- **success**: `true`
- **key**: CAS node key of the generated image.

**Output (error)**
- **success**: `false`
- **error**: Error message.
