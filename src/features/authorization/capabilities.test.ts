import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_CAPABILITIES,
  CAPABILITIES,
  getCapabilitiesForRole,
  getDocumentAccessFilter,
  hasCapability,
} from "./capabilities";

test("OWNER has every V1 capability", () => {
  assert.deepEqual(getCapabilitiesForRole("OWNER"), ALL_CAPABILITIES);
});

test("ADMIN can manage the team and view audit but not manage subscription", () => {
  const membership = { role: "ADMIN" as const };

  assert.equal(hasCapability(membership, CAPABILITIES.MANAGE_TEAM), true);
  assert.equal(hasCapability(membership, CAPABILITIES.VIEW_AUDIT_LOG), true);
  assert.equal(
    hasCapability(membership, CAPABILITIES.MANAGE_SUBSCRIPTION),
    false,
  );
});

test("MANAGER document and team capabilities match V1 defaults", () => {
  const membership = { role: "MANAGER" as const };

  assert.equal(hasCapability(membership, CAPABILITIES.ISSUE_DOCUMENT), true);
  assert.equal(
    hasCapability(membership, CAPABILITIES.VIEW_ALL_DOCUMENTS),
    true,
  );
  assert.equal(hasCapability(membership, CAPABILITIES.MANAGE_TEAM), false);
  assert.equal(hasCapability(membership, CAPABILITIES.VOID_DOCUMENT), false);
  assert.equal(hasCapability(membership, CAPABILITIES.VIEW_AUDIT_LOG), false);
});

test("STAFF is limited to own-document access and basic creation", () => {
  const membership = { role: "STAFF" as const };

  assert.equal(hasCapability(membership, CAPABILITIES.CREATE_DOCUMENT), true);
  assert.equal(
    hasCapability(membership, CAPABILITIES.VIEW_OWN_DOCUMENTS),
    true,
  );
  assert.equal(hasCapability(membership, CAPABILITIES.ISSUE_DOCUMENT), false);
  assert.equal(
    hasCapability(membership, CAPABILITIES.VIEW_ALL_DOCUMENTS),
    false,
  );
  assert.equal(hasCapability(membership, CAPABILITIES.MANAGE_TEAM), false);
});

test("STAFF document filters are scoped to workspace and creator", () => {
  assert.deepEqual(
    getDocumentAccessFilter({
      role: "STAFF",
      userId: "person-a",
      workspaceId: "workspace-a",
    }),
    {
      workspaceId: "workspace-a",
      createdByUserId: "person-a",
    },
  );

  assert.deepEqual(
    getDocumentAccessFilter({
      role: "MANAGER",
      userId: "person-a",
      workspaceId: "workspace-a",
    }),
    { workspaceId: "workspace-a" },
  );
});
