import { auth } from "@/auth";
import { findPersonalAssetForUser } from "@/features/profile/private-asset-access";
import { getObject } from "@/lib/storage/object-storage";

const allowedContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ asset: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ message: "Authentication required." }, { status: 401 });
  }

  const { asset } = await params;
  if (asset !== "photo" && asset !== "signature") {
    return Response.json({ message: "Private image not found." }, { status: 404 });
  }

  const metadata = await findPersonalAssetForUser(session.user.id, asset);

  if (!metadata || !allowedContentTypes.has(metadata.mimeType)) {
    return Response.json({ message: "Private image not found." }, { status: 404 });
  }

  try {
    const stored = await getObject(metadata.storageKey);
    return new Response(Buffer.from(stored.body), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "inline",
        "Content-Length": String(stored.body.byteLength),
        "Content-Type": metadata.mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ message: "Private image is unavailable." }, { status: 404 });
  }
}
