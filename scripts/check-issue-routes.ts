import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { addUtcMonth } from "../src/features/commercial/periods";
import { issueDocument } from "../src/features/documents/issuance";
import { createDraft } from "../src/features/documents/service";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3021";
const suffix = randomUUID();
const password = `Civ-issue-route-${randomUUID()}`;
const userIds: string[] = [];
const workspaceIds: string[] = [];

function updateCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}
function cookieHeader(jar: Map<string, string>) { return [...jar].map(([name, value]) => `${name}=${value}`).join("; "); }
async function signIn(email: string) {
  const cookies = new Map<string, string>();
  const csrf = await fetch(`${baseUrl}/api/auth/csrf`); updateCookies(cookies, csrf);
  const { csrfToken } = await csrf.json() as { csrfToken: string };
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(cookies) }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: "/app/documents" }) });
  updateCookies(cookies, response); assert.ok(response.status === 302 || response.status === 303); return cookies;
}

const passwordHash = await hashPassword(password);
const people = [];
for (const label of ["owner", "staff", "outsider"]) {
  const created = await db.user.create({ data: { name: `ISSUE route ${label}`, email: `issue-route-${label}-${suffix}@example.invalid`, passwordHash }, select: { id: true, email: true } });
  userIds.push(created.id); people.push(created);
}
const [owner, staff, outsider] = people as [typeof people[number], typeof people[number], typeof people[number]];
const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true, documentLimit: true } });
const periodStart = new Date(Date.now() - 60_000);
async function makeWorkspace(name: string, ownerId: string, memberships: Array<{ userId: string; role: "OWNER" | "STAFF" }> = []) {
  const created = await db.workspace.create({ data: { name, type: "BUSINESS", country: "GH", currency: "GHS", businessTin: `TIN-${suffix.slice(0, 8)}`, memberships: { create: [{ userId: ownerId, role: "OWNER", status: "ACTIVE" }, ...memberships.map((member) => ({ ...member, status: "ACTIVE" as const }))] }, subscription: { create: { planId: free.id, status: "BETA" } }, documentAllowancePeriods: { create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit } } }, select: { id: true } });
  workspaceIds.push(created.id); return created;
}
const workspace = await makeWorkspace(`ISSUE Route ${suffix.slice(0, 8)}`, owner.id, [{ userId: staff.id, role: "STAFF" }]);
const isolated = await makeWorkspace(`ISSUE Isolated ${suffix.slice(0, 8)}`, outsider.id);
const data = (type: "INVOICE" | "RECEIPT" = "INVOICE") => ({ type, customerId: null, currency: "GHS", draftDate: "2026-08-21", dueDate: "", notes: "HTTP issue fixture", lines: [{ catalogItemId: null, customRateId: null, description: "Route service", quantity: "1", unitPrice: "20.00" }] });

try {
  const ownerDraft = await createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: data() });
  const staffDraft = await createDraft({ actorUserId: staff.id, workspaceId: workspace.id, data: data("RECEIPT") });
  const issued = await issueDocument({ actorUserId: owner.id, workspaceId: workspace.id, documentId: ownerDraft.id });
  const signedOut = await fetch(`${baseUrl}/app/documents/${ownerDraft.id}`, { redirect: "manual" });
  assert.equal(signedOut.status, 307); assert.match(signedOut.headers.get("location") ?? "", /\/login/);

  const ownerCookies = await signIn(owner.email!); ownerCookies.set("civ-active-workspace", workspace.id);
  for (const [path, expected] of [[`/app/documents/${ownerDraft.id}`, issued.documentNumber], ["/app/documents", issued.documentNumber], ["/app/vault", issued.documentNumber], [`/app/documents/${staffDraft.id}`, "Issue Document"]] as const) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookieHeader(ownerCookies) } }); const page = await response.text();
    assert.equal(response.status, 200, path); assert.match(page, new RegExp(expected)); assert.doesNotMatch(page, /passwordHash|PAYSTACK_SECRET_KEY|R2_SECRET_ACCESS_KEY/);
    if (path.includes(ownerDraft.id)) { assert.match(page, /Issued workspace record · Read-only/); assert.doesNotMatch(page, /Save Draft|Archive Draft|Confirm Issue/); }
  }

  const staffCookies = await signIn(staff.email!); staffCookies.set("civ-active-workspace", workspace.id);
  const staffOwn = await fetch(`${baseUrl}/app/documents/${staffDraft.id}`, { headers: { Cookie: cookieHeader(staffCookies) } }); const staffOwnPage = await staffOwn.text();
  assert.equal(staffOwn.status, 200); assert.match(staffOwnPage, new RegExp(staffDraft.draftReference)); assert.doesNotMatch(staffOwnPage, /Issue Document|Confirm Issue/);
  const staffCross = await fetch(`${baseUrl}/app/documents/${ownerDraft.id}`, { headers: { Cookie: cookieHeader(staffCookies) } }); assert.equal(staffCross.status, 404);
  const outsiderCookies = await signIn(outsider.email!); outsiderCookies.set("civ-active-workspace", isolated.id);
  const outsiderCross = await fetch(`${baseUrl}/app/documents/${ownerDraft.id}`, { headers: { Cookie: cookieHeader(outsiderCookies) } }); assert.equal(outsiderCross.status, 404);
  console.log("PASS ISSUE HTTP signed-out protection, role-aware Issue visibility, immutable issued view, list/Vault records, and workspace isolation");
} finally {
  await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.documentCapacityConsumption.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.documentSnapshot.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
  await db.documentLine.deleteMany({ where: { document: { workspaceId: { in: workspaceIds } } } });
  await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.documentNumberSequence.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
  assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  await db.$disconnect();
}
