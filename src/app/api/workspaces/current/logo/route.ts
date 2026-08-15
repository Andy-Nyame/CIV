import { auth } from "@/auth";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";
import { db } from "@/lib/db";
import { getObject } from "@/lib/storage/object-storage";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Not found", { status: 404 });
  }

  const context = await getWorkspaceContextForUser(session.user.id);
  if (!context.current) {
    return new Response("Not found", { status: 404 });
  }

  const logo = await db.workspaceLogo.findUnique({
    where: { workspaceId: context.current.id },
    select: { storageKey: true, mimeType: true },
  });
  if (!logo) return new Response("Not found", { status: 404 });

  try {
    const object = await getObject(logo.storageKey);
    return new Response(Buffer.from(object.body), {
      headers: {
        "Content-Type": logo.mimeType,
        "Content-Disposition": "inline",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
