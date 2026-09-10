import "server-only";

import bwipjs from "@bwip-js/node";

import { normalizeVerificationCode } from "./code";

export const VERIFICATION_BARCODE_FORMAT = "CODE128" as const;

export function buildVerificationBarcodeOptions(input: unknown) {
  const code = normalizeVerificationCode(input);
  if (!code) return null;
  return {
    bcid: "code128",
    text: code,
    scale: 3,
    height: 11,
    includetext: false,
    paddingwidth: 8,
    paddingheight: 5,
    backgroundcolor: "FFFFFF",
    barcolor: "102A43",
  } as const;
}

export async function renderVerificationBarcodePng(input: unknown) {
  const options = buildVerificationBarcodeOptions(input);
  if (!options) return null;
  const bytes = await bwipjs.toBuffer(options);
  if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error("CIV verification barcode generation returned an invalid image.");
  }
  return {
    code: options.text,
    format: VERIFICATION_BARCODE_FORMAT,
    bytes,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  } as const;
}
