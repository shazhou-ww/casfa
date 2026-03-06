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
2. Upload the result to the specified CASFA branch
3. Complete the branch (merge back to parent)

## Parameters

- **prompt** (required): Text description of the desired image
- **filename** (required): Output filename (e.g. "output.png")
- **width/height** (optional): Output dimensions in pixels (64-2048, default 1024)
- **seed** (optional): Seed for reproducible results
- **output_format** (optional): "jpeg" or "png" (default "jpeg")
