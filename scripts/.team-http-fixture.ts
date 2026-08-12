import { hashPassword } from "../src/features/auth/password";
import { hashInvitationToken } from "../src/features/team/token";
import { db } from "../src/lib/db";

const prefix = "phase0e3-http-";
const inviteeEmail = `${prefix}invitee@example.test`;
const ownerEmail = `${prefix}owner@example.test`;
const token = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function cleanup() {
  const users = await db.user.findMany({
    where: { email: { startsWith: prefix } },
    select: { id: true },
  });
  const userIds = users.map(({ id }) => id);
  const workspaces = await db.workspace.findMany({
    where: { name: { startsWith: prefix } },
    select: { id: true },
  });
  const workspaceIds = workspaces.map(({ id }) => id);

  if (workspaceIds.length) {
    await db.invitation.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  if (userIds.length) {
    await db.account.deleteMany({ where: { userId: { in: userIds } } });
    await db.session.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function setup() {
  await cleanup();
  const plan = await db.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
  const passwordHash = await hashPassword("phase0e3-password");
  const [owner, invitee] = await Promise.all([
    db.user.create({ data: { email: ownerEmail, name: "HTTP Owner", passwordHash } }),
    db.user.create({ data: { email: inviteeEmail, name: "HTTP Invitee", passwordHash } }),
  ]);
  await db.workspace.create({
    data: {
      name: `${prefix}workspace`,
      type: "BUSINESS",
      memberships: { create: { userId: owner.id, role: "OWNER", status: "ACTIVE" } },
      subscription: {
        create: { planId: plan.id, status: "BETA", startedAt: new Date() },
      },
      invitations: {
        create: {
          email: inviteeEmail,
          role: "STAFF",
          status: "PENDING",
          invitedByUserId: owner.id,
          tokenHash: hashInvitationToken(token),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    },
  });
}

const command = process.argv[2];
try {
  if (command === "setup") await setup();
  else if (command === "cleanup") await cleanup();
  else throw new Error("Expected setup or cleanup.");
  console.log(`Team HTTP fixture ${command} complete.`);
} finally {
  await db.$disconnect();
}
