import { bootstrapDevelopmentPlatformOwner } from "@/features/platform-admin/bootstrap";
import { PlatformBootstrapError } from "@/features/platform-admin/errors";

try {
  const membership = await bootstrapDevelopmentPlatformOwner({
    appEnvironment: process.env.APP_ENV,
    email: process.env.CIV_PLATFORM_OWNER_EMAIL,
  });
  console.log(
    membership.role === "PLATFORM_OWNER" && membership.status === "ACTIVE"
      ? "Development Platform Owner bootstrap complete."
      : "Development Platform Owner bootstrap did not complete.",
  );
} catch (error) {
  if (error instanceof PlatformBootstrapError) {
    const messages = {
      INVALID_ENVIRONMENT: "Bootstrap is restricted to APP_ENV=development.",
      EMAIL_REQUIRED: "CIV_PLATFORM_OWNER_EMAIL is required in the ignored development environment.",
      INVALID_EMAIL: "CIV_PLATFORM_OWNER_EMAIL must contain a valid email address.",
      USER_NOT_FOUND: "No existing CIV User matches CIV_PLATFORM_OWNER_EMAIL. Sign in or register that account first.",
      OWNER_ALREADY_EXISTS: "A different active Platform Owner already exists. Bootstrap will not replace it.",
      INCONSISTENT_OWNERS: "Platform Owner records are inconsistent and require manual review.",
    } as const;
    console.error(messages[error.reason]);
    process.exitCode = 1;
  } else {
    console.error("Development Platform Owner bootstrap failed safely.");
    process.exitCode = 1;
  }
} finally {
  const { db } = await import("@/lib/db");
  await db.$disconnect();
}
