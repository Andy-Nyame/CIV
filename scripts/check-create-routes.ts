import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { hashPassword } from "../src/features/auth/password";
import { addUtcMonth } from "../src/features/commercial/periods";
import { createCatalogueItem } from "../src/features/catalog/service";
import { createCustomer } from "../src/features/customers/service";
import { createDraft } from "../src/features/documents/service";
import { db } from "../src/lib/db";

const baseUrl = process.env.CIV_TEST_BASE_URL ?? "http://localhost:3021";
const suffix = randomUUID();
const password = `Civ-create-route-${randomUUID()}`;
const userIds: string[] = [];
const workspaceIds: string[] = [];

function updateCookies(jar: Map<string, string>, response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";", 1);
    const separator = pair.indexOf("=");
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

function cookieHeader(jar: Map<string, string>) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signIn(email: string) {
  const cookies = new Map<string, string>();
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  updateCookies(cookies, csrfResponse);
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(cookies) },
    body: new URLSearchParams({ csrfToken, email, password, callbackUrl: "/app/documents" }),
  });
  updateCookies(cookies, response);
  assert.ok(response.status === 302 || response.status === 303);
  return cookies;
}

const passwordHash = await hashPassword(password);
const [owner, staff, outsider] = await Promise.all(["owner", "staff", "outsider"].map(async (label) => {
  const user = await db.user.create({
    data: { name: `CREATE route ${label}`, email: `create-route-${label}-${suffix}@example.invalid`, passwordHash },
    select: { id: true, email: true },
  });
  userIds.push(user.id);
  return user;
}));
const free = await db.plan.findUniqueOrThrow({ where: { code: "FREE" }, select: { id: true, documentLimit: true } });
const periodStart = new Date(Date.now() - 60_000);
const workspace = await db.workspace.create({
  data: {
    name: `CREATE Route Workspace ${suffix.slice(0, 8)}`,
    type: "BUSINESS",
    memberships: { create: [{ userId: owner.id, role: "OWNER", status: "ACTIVE" }, { userId: staff.id, role: "STAFF", status: "ACTIVE" }] },
    subscription: { create: { planId: free.id, status: "BETA" } },
    documentAllowancePeriods: { create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit } },
  },
  select: { id: true, name: true },
});
workspaceIds.push(workspace.id);
const isolatedWorkspace = await db.workspace.create({
  data: {
    name: `CREATE Route Isolated ${suffix.slice(0, 8)}`,
    type: "BUSINESS",
    memberships: { create: { userId: outsider.id, role: "OWNER", status: "ACTIVE" } },
    subscription: { create: { planId: free.id, status: "BETA" } },
    documentAllowancePeriods: { create: { planId: free.id, periodStart, periodEnd: addUtcMonth(periodStart), allowance: free.documentLimit } },
  },
  select: { id: true, name: true },
});
workspaceIds.push(isolatedWorkspace.id);

try {
  const customer = await createCustomer({ actorUserId: owner.id, workspaceId: workspace.id, data: { name: "CREATE Route Customer", email: "route@example.invalid", phone: "", address: "Accra", businessTin: "", notes: "" } });
  const item = await createCatalogueItem({ actorUserId: owner.id, workspaceId: workspace.id, data: { name: "CREATE Route Service", description: "Route fixture", type: "SERVICE", unitPrice: "25.00", currency: "GHS", unitLabel: "service", sku: `ROUTE-${suffix.slice(0, 8)}` } });
  const ownerDraft = await createDraft({ actorUserId: owner.id, workspaceId: workspace.id, data: { type: "VAT_INVOICE", customerId: customer.id, currency: "GHS", draftDate: "2026-08-21", dueDate: "", notes: "Owner-only route draft", lines: [{ catalogItemId: item.id, customRateId: null, description: "CREATE Route Service", quantity: "2", unitPrice: "25.00" }] } });
  const staffDraft = await createDraft({ actorUserId: staff.id, workspaceId: workspace.id, data: { type: "RECEIPT", customerId: customer.id, currency: "GHS", draftDate: "2026-08-21", dueDate: "", notes: "Staff-own route draft", lines: [{ catalogItemId: null, customRateId: null, description: "Staff service", quantity: "1", unitPrice: "10.00" }] } });

  for (const path of ["/app/customers", "/app/items", "/app/documents", "/app/documents/new", `/app/documents/${ownerDraft.id}`]) {
    const response = await fetch(`${baseUrl}${path}`, { redirect: "manual" });
    assert.equal(response.status, 307, `signed-out ${path}`);
    assert.match(response.headers.get("location") ?? "", /\/login/);
  }

  const ownerCookies = await signIn(owner.email!);
  ownerCookies.set("civ-active-workspace", workspace.id);
  const ownerExpectations = [
    ["/app/customers", "CREATE Route Customer"],
    ["/app/items", "CREATE Route Service"],
    ["/app/documents", ownerDraft.draftReference],
    ["/app/documents/new?type=VAT_INVOICE", "VAT invoice"],
    [`/app/documents/${ownerDraft.id}`, ownerDraft.draftReference],
  ] as const;
  for (const [path, expected] of ownerExpectations) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookieHeader(ownerCookies) } });
    const page = await response.text();
    assert.equal(response.status, 200, path);
    assert.match(page, new RegExp(expected));
    assert.doesNotMatch(page, /passwordHash|DATABASE_URL|PAYSTACK_SECRET_KEY|R2_SECRET_ACCESS_KEY/);
  }

  const staffCookies = await signIn(staff.email!);
  staffCookies.set("civ-active-workspace", workspace.id);
  const staffDocuments = await fetch(`${baseUrl}/app/documents`, { headers: { Cookie: cookieHeader(staffCookies) } });
  const staffPage = await staffDocuments.text();
  assert.equal(staffDocuments.status, 200);
  assert.match(staffPage, new RegExp(staffDraft.draftReference));
  assert.doesNotMatch(staffPage, new RegExp(ownerDraft.draftReference));
  for (const [path, forbiddenCopy] of [["/app/customers", "New customer"], ["/app/items", "New entry"]] as const) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookieHeader(staffCookies) } });
    const page = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(page, new RegExp(forbiddenCopy));
  }
  const staffCrossDraft = await fetch(`${baseUrl}/app/documents/${ownerDraft.id}`, { headers: { Cookie: cookieHeader(staffCookies) } });
  assert.equal(staffCrossDraft.status, 404);

  const outsiderCookies = await signIn(outsider.email!);
  outsiderCookies.set("civ-active-workspace", isolatedWorkspace.id);
  const outsiderCrossDraft = await fetch(`${baseUrl}/app/documents/${ownerDraft.id}`, { headers: { Cookie: cookieHeader(outsiderCookies) } });
  assert.equal(outsiderCrossDraft.status, 404);
  const isolatedDocuments = await fetch(`${baseUrl}/app/documents`, { headers: { Cookie: cookieHeader(outsiderCookies) } });
  const isolatedPage = await isolatedDocuments.text();
  assert.equal(isolatedDocuments.status, 200);
  assert.doesNotMatch(isolatedPage, new RegExp(ownerDraft.draftReference));
  assert.doesNotMatch(isolatedPage, new RegExp(staffDraft.draftReference));

  console.log("PASS CREATE routes, signed-out protection, staff-own filtering, mutation-control visibility, and workspace isolation");
} finally {
  if (workspaceIds.length) {
    await db.auditEvent.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.document.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.itemService.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.customer.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspaceDocumentAllowancePeriod.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.subscription.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.membership.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await db.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }
  if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
  assert.equal(await db.platformMembership.count({ where: { role: "PLATFORM_OWNER", status: "ACTIVE" } }), 1);
  await db.$disconnect();
}
