import "server-only";

import { createHash } from "node:crypto";

import sharp, { type Metadata } from "sharp";

import {
  signatureFileConstraints,
  validateSignatureDimensions,
  validateSignatureFileDescriptor,
} from "./signature";

const allowedMimeByFormat = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export const profilePhotoConstraints = {
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  maxSizeBytes: 5 * 1024 * 1024,
  minWidth: 64,
  minHeight: 64,
  maxWidth: 6000,
  maxHeight: 6000,
  outputSize: 512,
} as const;

export type ProcessedPrivateImage = {
  body: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
  checksum: string;
};

export class PrivateImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivateImageValidationError";
  }
}

function assertDeclaredRasterType(type: string) {
  if (!profilePhotoConstraints.allowedMimeTypes.includes(type as never)) {
    throw new PrivateImageValidationError(
      "Use a PNG, JPEG, or WebP image. SVG files are not accepted.",
    );
  }
}

async function inspectRaster(file: File, maxSizeBytes: number) {
  assertDeclaredRasterType(file.type);
  if (file.size <= 0 || file.size > maxSizeBytes) {
    throw new PrivateImageValidationError(
      `Image must be ${Math.floor(maxSizeBytes / (1024 * 1024))} MB or smaller.`,
    );
  }

  const body = new Uint8Array(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(body, { limitInputPixels: 36_000_000 }).metadata();
  } catch {
    throw new PrivateImageValidationError("CIV could not read this image.");
  }

  const decodedMime = metadata.format
    ? allowedMimeByFormat[metadata.format as keyof typeof allowedMimeByFormat]
    : undefined;
  if (!decodedMime || decodedMime !== file.type || !metadata.width || !metadata.height) {
    throw new PrivateImageValidationError(
      "The image content does not match a supported PNG, JPEG, or WebP file.",
    );
  }
  if ((metadata.pages ?? 1) !== 1) {
    throw new PrivateImageValidationError("Animated or multi-page images are not supported.");
  }

  return { body, metadata, mimeType: decodedMime };
}

function checksum(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex");
}

export async function processSignatureImage(file: File): Promise<ProcessedPrivateImage> {
  const descriptorError = validateSignatureFileDescriptor(file);
  if (descriptorError) throw new PrivateImageValidationError(descriptorError);

  const inspected = await inspectRaster(file, signatureFileConstraints.maxSizeBytes);
  const width = inspected.metadata.width!;
  const height = inspected.metadata.height!;
  const dimensionError = validateSignatureDimensions(width, height);
  if (dimensionError) throw new PrivateImageValidationError(dimensionError);

  return {
    body: inspected.body,
    mimeType: inspected.mimeType,
    width,
    height,
    sizeBytes: inspected.body.byteLength,
    checksum: checksum(inspected.body),
  };
}

export async function processProfilePhoto(file: File): Promise<ProcessedPrivateImage> {
  const inspected = await inspectRaster(file, profilePhotoConstraints.maxSizeBytes);
  const width = inspected.metadata.width!;
  const height = inspected.metadata.height!;

  if (
    width < profilePhotoConstraints.minWidth ||
    height < profilePhotoConstraints.minHeight ||
    width > profilePhotoConstraints.maxWidth ||
    height > profilePhotoConstraints.maxHeight
  ) {
    throw new PrivateImageValidationError(
      "Profile photos must be between 64 × 64 and 6000 × 6000 pixels.",
    );
  }

  const output = await sharp(inspected.body)
    .rotate()
    .resize(profilePhotoConstraints.outputSize, profilePhotoConstraints.outputSize, {
      fit: "cover",
      position: "attention",
    })
    .webp({ quality: 84 })
    .toBuffer();

  return {
    body: output,
    mimeType: "image/webp",
    width: profilePhotoConstraints.outputSize,
    height: profilePhotoConstraints.outputSize,
    sizeBytes: output.byteLength,
    checksum: checksum(output),
  };
}
