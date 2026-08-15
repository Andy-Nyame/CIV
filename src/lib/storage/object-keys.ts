import { randomUUID } from "node:crypto";

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type PrivateImageKind = "profile" | "signatures";

export function createUserImageKey(input: {
  userId: string;
  kind: PrivateImageKind;
  mimeType: keyof typeof EXTENSIONS;
}) {
  if (!/^[a-f0-9-]{36}$/i.test(input.userId)) {
    throw new Error("Invalid user identity for object key.");
  }

  return `users/${input.userId}/${input.kind}/${randomUUID()}.${EXTENSIONS[input.mimeType]}`;
}

export function createWorkspaceLogoKey(workspaceId: string) {
  if (!/^[a-f0-9-]{36}$/i.test(workspaceId)) {
    throw new Error("Invalid workspace identity for object key.");
  }

  return `workspaces/${workspaceId}/logo/${randomUUID()}.webp`;
}
