import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { signOutForInvitationAction } from "@/features/auth/actions";
import { platformRoleLabel } from "@/features/platform-admin/presentation";
import { acceptPlatformInvitationAction } from "@/features/platform-team/actions";
import { getPlatformInvitationByToken } from "@/features/platform-team/invitation-service";

export const metadata: Metadata = { title: "Platform Team Invitation" };

const errorMessages: Record<string, string> = {
  INVALID: "This platform invitation link is invalid or no longer available.",
  EXPIRED: "This platform invitation has expired. Ask the inviter for a new link.",
  CANCELLED: "This platform invitation has been cancelled.",
  ACCEPTED: "This platform invitation has already been accepted.",
  EMAIL_MISMATCH:
    "This invitation was sent to another account. Sign in with the invited email address.",
};

export default async function PlatformInvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;
  const [session, invitation] = await Promise.all([
    auth(),
    getPlatformInvitationByToken(token),
  ]);
  const callbackUrl = `/platform-invite/${token}`;
  const error =
    typeof query.error === "string" ? errorMessages[query.error] : null;
  const canAccept = invitation?.status === "PENDING";
  const emailMatches =
    session?.user?.email?.trim().toLowerCase() === invitation?.email;

  return (
    <section className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <p className="text-sm font-semibold text-link">CIV platform team invitation</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-text">
        {invitation ? "Join the CIV platform team" : "Invitation unavailable"}
      </h1>
      {invitation ? (
        <div className="mt-5 grid gap-3 rounded-xl border border-border bg-page p-4 text-sm">
          <p className="text-text">Invited email: <strong>{invitation.email}</strong></p>
          <p className="text-text">Platform role: <strong>{platformRoleLabel(invitation.role)}</strong></p>
          <p className="text-muted">Expires <time dateTime={invitation.expiresAt.toISOString()}>{invitation.expiresAt.toLocaleString("en-GH", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</time></p>
        </div>
      ) : null}
      {error ? <p className="mt-5 text-sm leading-6 text-danger" role="alert">{error}</p> : null}
      {!invitation || !canAccept ? (
        <p className="mt-5 text-sm leading-6 text-muted">
          {!invitation ? "Check the link or ask the inviter for a new platform invitation." : errorMessages[invitation.status] ?? "This invitation cannot be accepted."}
        </p>
      ) : !session?.user ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link className="grid min-h-12 place-items-center rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover" href={`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Sign In</Link>
          <Link className="grid min-h-12 place-items-center rounded-lg border border-border px-4 font-semibold text-text hover:bg-hover" href={`/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`}>Create Account</Link>
        </div>
      ) : !emailMatches ? (
        <div className="mt-5">
          <p className="text-sm leading-6 text-danger" role="alert">This invitation was sent to another account. Sign in with {invitation.email}.</p>
          <form action={signOutForInvitationAction} className="mt-4">
            <input type="hidden" name="callbackUrl" value={callbackUrl} />
            <button className="min-h-11 rounded-lg border border-border px-4 font-semibold text-text hover:bg-hover">Sign out and use another account</button>
          </form>
        </div>
      ) : (
        <form action={acceptPlatformInvitationAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button className="min-h-12 w-full rounded-lg bg-civ-blue px-4 font-semibold text-white hover:bg-civ-blue-hover">Accept Platform Invitation</button>
        </form>
      )}
    </section>
  );
}
