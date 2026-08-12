export const signatureFileConstraints = {
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  maxSizeBytes: 1024 * 1024,
  minWidth: 32,
  minHeight: 16,
  maxWidth: 4096,
  maxHeight: 4096,
} as const;

export function validateSignatureFileDescriptor(input: {
  type: string;
  size: number;
}) {
  if (
    !signatureFileConstraints.allowedMimeTypes.includes(
      input.type as (typeof signatureFileConstraints.allowedMimeTypes)[number],
    )
  ) {
    return "Use a PNG, JPEG, or WebP image. SVG files are not accepted.";
  }

  if (input.size <= 0 || input.size > signatureFileConstraints.maxSizeBytes) {
    return "Signature images must be 1 MB or smaller.";
  }

  return null;
}

export function validateSignatureDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < signatureFileConstraints.minWidth ||
    height < signatureFileConstraints.minHeight
  ) {
    return "Signature image dimensions are too small.";
  }

  if (
    width > signatureFileConstraints.maxWidth ||
    height > signatureFileConstraints.maxHeight
  ) {
    return "Signature images must be no larger than 4096 × 4096 pixels.";
  }

  return null;
}
