import "server-only";

import sharp from "sharp";

import {
  calculateImageChecksum,
  inspectPrivateRaster,
  PrivateImageValidationError,
  type ProcessedPrivateImage,
} from "@/features/profile/private-images";

export const workspaceLogoConstraints = {
  maxSizeBytes: 5 * 1024 * 1024,
  minWidth: 32,
  minHeight: 32,
  maxWidth: 6000,
  maxHeight: 6000,
  outputSize: 512,
} as const;

export async function processWorkspaceLogo(
  file: File,
): Promise<ProcessedPrivateImage> {
  const inspected = await inspectPrivateRaster(
    file,
    workspaceLogoConstraints.maxSizeBytes,
  );
  const width = inspected.metadata.width!;
  const height = inspected.metadata.height!;

  if (
    width < workspaceLogoConstraints.minWidth ||
    height < workspaceLogoConstraints.minHeight ||
    width > workspaceLogoConstraints.maxWidth ||
    height > workspaceLogoConstraints.maxHeight
  ) {
    throw new PrivateImageValidationError(
      "Workspace logos must be between 32 × 32 and 6000 × 6000 pixels.",
    );
  }

  const output = await sharp(inspected.body)
    .rotate()
    .resize(workspaceLogoConstraints.outputSize, workspaceLogoConstraints.outputSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 88, alphaQuality: 100 })
    .toBuffer();

  return {
    body: output,
    mimeType: "image/webp",
    width: workspaceLogoConstraints.outputSize,
    height: workspaceLogoConstraints.outputSize,
    sizeBytes: output.byteLength,
    checksum: calculateImageChecksum(output),
  };
}
