import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import sharp from "sharp";

import { db } from "@/lib/db";
import { objectExists } from "@/lib/storage/object-storage";

import { chooseProfileImage } from "./image";
import { findPersonalAssetForUser } from "./private-asset-access";
import {
  PrivateImageValidationError,
  processProfilePhoto,
  processSignatureImage,
} from "./private-images";
import {
  removePersonalProfilePhoto,
  removePersonalSignature,
  savePersonalProfilePhoto,
  savePersonalSignature,
} from "./service";

async function rasterFile(
  format: "jpeg" | "png" | "webp",
  width: number,
  height: number,
  name: string,
) {
  const body = await sharp({
    create: { width, height, channels: 4, background: { r: 16, g: 42, b: 67, alpha: 0.45 } },
  })
    [format]()
    .toBuffer();
  const mime = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  return new File([body], name, { type: mime });
}

test("server image processing rejects SVG, malformed, oversized, and MIME mismatches", async () => {
  await assert.rejects(
    processSignatureImage(new File(["<svg/>"] , "signature.svg", { type: "image/svg+xml" })),
    PrivateImageValidationError,
  );
  await assert.rejects(
    processSignatureImage(new File(["not an image"], "signature.png", { type: "image/png" })),
    PrivateImageValidationError,
  );
  await assert.rejects(
    processSignatureImage(new File([new Uint8Array(1024 * 1024 + 1)], "large.png", { type: "image/png" })),
    PrivateImageValidationError,
  );
  const png = await rasterFile("png", 128, 128, "wrong.jpg");
  await assert.rejects(
    processProfilePhoto(new File([await png.arrayBuffer()], "wrong.jpg", { type: "image/jpeg" })),
    PrivateImageValidationError,
  );
});

test("private signature and profile photo persist, replace, authorize, and remove", async () => {
  const suffix = randomUUID();
  const owner = await db.user.create({
    data: { email: `civ-storage-owner-${suffix}@example.invalid`, image: "https://lh3.googleusercontent.com/oauth-fallback" },
    select: { id: true },
  });
  const other = await db.user.create({
    data: { email: `civ-storage-other-${suffix}@example.invalid` },
    select: { id: true },
  });

  try {
    const drawnSignature = await rasterFile("png", 1200, 360, "drawn-signature.png");
    await savePersonalSignature(owner.id, drawnSignature);
    const firstSignature = await db.signatureProfile.findUniqueOrThrow({ where: { userId: owner.id } });
    assert.equal(firstSignature.checksum.length, 64);
    assert.equal(await objectExists(firstSignature.storageKey), true);
    assert.equal(await findPersonalAssetForUser(other.id, "signature"), null);

    await savePersonalSignature(owner.id, await rasterFile("webp", 1000, 300, "uploaded.webp"));
    const replacement = await db.signatureProfile.findUniqueOrThrow({ where: { userId: owner.id } });
    assert.notEqual(replacement.storageKey, firstSignature.storageKey);
    assert.equal(await objectExists(firstSignature.storageKey), false);
    assert.equal(await objectExists(replacement.storageKey), true);

    await savePersonalProfilePhoto(owner.id, await rasterFile("jpeg", 900, 700, "photo.jpg"));
    const photo = await db.profilePhoto.findUniqueOrThrow({ where: { userId: owner.id } });
    assert.equal(photo.mimeType, "image/webp");
    assert.equal(photo.width, 512);
    assert.equal(photo.height, 512);
    assert.equal(await objectExists(photo.storageKey), true);
    assert.equal(await findPersonalAssetForUser(other.id, "photo"), null);
    assert.equal(
      chooseProfileImage("/api/profile/assets/photo", "https://lh3.googleusercontent.com/oauth-fallback"),
      "/api/profile/assets/photo",
    );

    await removePersonalProfilePhoto(owner.id);
    assert.equal(await db.profilePhoto.findUnique({ where: { userId: owner.id } }), null);
    assert.equal(await objectExists(photo.storageKey), false);
    assert.equal(
      chooseProfileImage(null, "https://lh3.googleusercontent.com/oauth-fallback"),
      "https://lh3.googleusercontent.com/oauth-fallback",
    );

    await removePersonalSignature(owner.id);
    assert.equal(await db.signatureProfile.findUnique({ where: { userId: owner.id } }), null);
    assert.equal(await objectExists(replacement.storageKey), false);
  } finally {
    const remainingSignature = await db.signatureProfile.findUnique({ where: { userId: owner.id } });
    const remainingPhoto = await db.profilePhoto.findUnique({ where: { userId: owner.id } });
    if (remainingSignature) await removePersonalSignature(owner.id).catch(() => undefined);
    if (remainingPhoto) await removePersonalProfilePhoto(owner.id).catch(() => undefined);
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } });
  }
});
