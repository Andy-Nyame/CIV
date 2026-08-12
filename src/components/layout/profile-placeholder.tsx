import Image from "next/image";
import Link from "next/link";

import { signOutAction } from "@/features/auth/actions";
import { getTrustedProfileImage } from "@/features/profile/image";

type UserProfileProps = {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
};

export function UserProfile({ user }: UserProfileProps) {
  const displayName = user.name?.trim() || "CIV user";
  const initial = (user.name?.trim() || user.email || "C").charAt(0).toUpperCase();
  const profileImage = getTrustedProfileImage(user.image);

  return (
    <div className="grid gap-2">
      <Link
        href="/app/profile"
        className="flex min-h-12 items-center gap-3 rounded-lg px-2 hover:bg-hover"
        aria-label="Open personal profile settings"
      >
        {profileImage ? (
          <Image
            alt=""
            className="size-9 shrink-0 rounded-full object-cover"
            height={36}
            src={profileImage}
            width={36}
          />
        ) : (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-full bg-civ-navy text-sm font-bold text-white"
            aria-hidden="true"
          >
            {initial}
          </span>
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text">
            {displayName}
          </span>
          {user.email ? (
            <span className="block truncate text-xs text-muted">{user.email}</span>
          ) : null}
        </span>
      </Link>
      <form action={signOutAction}>
        <button
          type="submit"
          className="min-h-11 w-full rounded-lg border border-border px-3 text-sm font-semibold text-text hover:bg-hover"
        >
          Sign Out
        </button>
      </form>
    </div>
  );
}
