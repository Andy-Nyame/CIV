import Image from "next/image";

import { renderVerificationBarcodePng } from "@/features/documents/verification/barcode";

export async function VerificationBarcode({ code }: { code: string }) {
  const barcode = await renderVerificationBarcodePng(code);
  if (!barcode) return null;
  const source = `data:image/png;base64,${barcode.bytes.toString("base64")}`;

  return <Image
    alt={`CODE128 barcode encoding verification code ${barcode.code}`}
    className="h-auto max-h-24 w-full max-w-xl object-contain object-left"
    height={barcode.height}
    src={source}
    unoptimized
    width={barcode.width}
  />;
}
