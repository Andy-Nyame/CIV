import { auth } from "@/auth";
import { WorkspaceAuthorizationError } from "@/features/authorization/errors";
import { DocumentPdfUnavailableError, generateIssuedDocumentPdf } from "@/features/documents/pdf/service";
import { getWorkspaceContextForUser } from "@/features/workspaces/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });

  const workspaceContext = await getWorkspaceContextForUser(session.user.id);
  if (!workspaceContext.current) return new Response("Not found", { status: 404 });

  try {
    const generated = await generateIssuedDocumentPdf({
      actorUserId: session.user.id,
      workspaceId: workspaceContext.current.id,
      documentId: (await params).documentId,
    });
    return new Response(Buffer.from(generated.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${generated.filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof DocumentPdfUnavailableError || error instanceof WorkspaceAuthorizationError) {
      return new Response("Not found", { status: 404 });
    }
    return new Response("Unable to generate this document PDF.", { status: 500 });
  }
}
