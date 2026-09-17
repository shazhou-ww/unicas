import { describe, expect, test } from "vitest";
import {
  appAdminRoutes,
  casAdminRoutes,
  matchAppAdminRoute,
  matchCasAdminRoute,
} from "../src/index.js";

describe("CAS admin routes", () => {
  test.each([
    ["GET", casAdminRoutes.me(), "me"],
    ["GET", casAdminRoutes.stacks(), "listStacks"],
    ["POST", casAdminRoutes.stacks(), "createStack"],
    ["GET", casAdminRoutes.stack({ stackId: "stack/a" }), "getStack"],
    ["PATCH", casAdminRoutes.stack({ stackId: "stack/a" }), "patchStack"],
    ["GET", casAdminRoutes.members({ stackId: "stack/a" }), "listMembers"],
    ["DELETE", casAdminRoutes.members({ stackId: "stack/a" }), "deleteMember"],
    ["POST", casAdminRoutes.memberInvitations({ stackId: "stack/a" }), "createMemberInvitation"],
    ["POST", casAdminRoutes.acceptMemberInvitation({ token: "tok/1" }), "acceptMemberInvitation"],
    ["GET", casAdminRoutes.oauthIssuer({ stackId: "stack/a" }), "getOAuthIssuer"],
    ["POST", casAdminRoutes.managedCapability({ stackId: "stack/a" }), "mintManagedCapability"],
    ["PUT", casAdminRoutes.oauthIssuer({ stackId: "stack/a" }), "activateOAuthIssuer"],
    ["POST", casAdminRoutes.oauthIssuerInspections({ stackId: "stack/a" }), "inspectOAuthIssuer"],
    ["GET", casAdminRoutes.refDomains({ stackId: "stack/a" }), "listRefDomains"],
    ["GET", casAdminRoutes.controlAuditEvents({ stackId: "stack/a" }), "listControlAuditEvents"],
    ["GET", casAdminRoutes.rootDomainRefs({ stackId: "stack/a", refDomain: "doc" }), "listRootDomainRefs"],
    ["GET", casAdminRoutes.rootDomainEvents({ stackId: "stack/a", refDomain: "doc" }), "listRootDomainEvents"],
    ["GET", casAdminRoutes.platformInvitations(), "listPlatformInvitations"],
    ["POST", casAdminRoutes.platformInvitations(), "createPlatformInvitation"],
    ["DELETE", casAdminRoutes.platformInvitation({ invitationId: "invite/1" }), "revokePlatformInvitation"],
    ["POST", casAdminRoutes.acceptPlatformInvitation({ token: "tok/1" }), "acceptPlatformInvitation"],
    ["GET", casAdminRoutes.platformAuditEvents(), "listPlatformAuditEvents"],
    ["GET", casAdminRoutes.platformPrincipalAccess({ principalRef: "principal/1" }), "getPlatformAccess"],
  ] as const)("matches %s %s -> %s", (method, pathname, operation) => {
    expect(matchCasAdminRoute(method, pathname)).toMatchObject({ operation });
  });

  test("encodes path segments", () => {
    expect(casAdminRoutes.stack({ stackId: "stack/a" })).toBe("/admin/stacks/stack%2Fa");
    expect(casAdminRoutes.rootDomainRefs({ stackId: "s", refDomain: "doc:md" }))
      .toBe("/admin/stacks/s/root-ref-domains/doc%3Amd/refs");
  });

  test("rejects tenant paths and wrong methods", () => {
    expect(matchCasAdminRoute("GET", "/stacks/s/tenants/t/usage")).toBeNull();
    expect(matchCasAdminRoute("GET", "/tenants/t/cas/usage")).toBeNull();
    expect(matchCasAdminRoute("POST", casAdminRoutes.me())).toBeNull();
    expect(matchCasAdminRoute("POST", casAdminRoutes.refDomains({ stackId: "s" }))).toBeNull();
    expect(matchCasAdminRoute("PATCH", casAdminRoutes.oauthIssuer({ stackId: "s" }))).toBeNull();
    expect(matchCasAdminRoute("GET", casAdminRoutes.managedCapability({ stackId: "s" }))).toBeNull();
    expect(matchCasAdminRoute("GET", casAdminRoutes.oauthIssuerInspections({ stackId: "s" }))).toBeNull();
    expect(matchCasAdminRoute("GET", "/admin/%ZZ/stacks")).toBeNull();
    expect(matchCasAdminRoute("GET", "/admin/stacks/s/playground/file-roots")).toBeNull();
    expect(matchCasAdminRoute("POST", "/admin/stacks/s/playground/file-roots")).toBeNull();
    expect(matchCasAdminRoute("PATCH", "/admin/stacks/s/playground/file-roots/r")).toBeNull();
    expect(matchCasAdminRoute("DELETE", "/admin/stacks/s/playground/file-roots/r")).toBeNull();
  });

  test("never emits tenant operation names", () => {
    const route = matchCasAdminRoute(
      "GET",
      casAdminRoutes.rootDomainRefs({ stackId: "s", refDomain: "doc" }),
    );
    expect(route?.operation).toBe("listRootDomainRefs");
    expect(JSON.stringify(route)).not.toMatch(/updateRootRefs|readContent|rootRefs/);
  });
});

describe("App admin routes", () => {
  test.each([
    ["GET", appAdminRoutes.me(), "me"],
    ["GET", appAdminRoutes.account(), "getAccount"],
    ["PATCH", appAdminRoutes.accountProfile(), "patchAccountProfile"],
    ["GET", appAdminRoutes.accountIdentities(), "listAccountIdentities"],
    ["GET", appAdminRoutes.apps(), "listApps"],
    ["POST", appAdminRoutes.apps(), "createApp"],
    ["GET", appAdminRoutes.app({ appId: "app/a" }), "getApp"],
    ["PATCH", appAdminRoutes.app({ appId: "app/a" }), "patchApp"],
    ["GET", appAdminRoutes.members({ appId: "app/a" }), "listMembers"],
    ["DELETE", appAdminRoutes.members({ appId: "app/a" }), "deleteMember"],
    ["POST", appAdminRoutes.memberInvitations({ appId: "app/a" }), "createMemberInvitation"],
    ["POST", appAdminRoutes.acceptMemberInvitation({ token: "tok/1" }), "acceptMemberInvitation"],
    ["GET", appAdminRoutes.oauthIssuer({ appId: "app/a" }), "getOAuthIssuer"],
    ["PUT", appAdminRoutes.oauthIssuer({ appId: "app/a" }), "activateOAuthIssuer"],
    ["POST", appAdminRoutes.oauthIssuerInspections({ appId: "app/a" }), "inspectOAuthIssuer"],
    ["GET", appAdminRoutes.managedIssuer({ appId: "app/a" }), "getManagedIssuer"],
    ["PATCH", appAdminRoutes.managedIssuer({ appId: "app/a" }), "patchManagedIssuer"],
    ["POST", appAdminRoutes.managedCapability({ appId: "app/a" }), "mintManagedCapability"],
    ["GET", appAdminRoutes.refDomains({ appId: "app/a" }), "listRefDomains"],
    ["GET", appAdminRoutes.controlAuditEvents({ appId: "app/a" }), "listControlAuditEvents"],
    ["GET", appAdminRoutes.rootDomainRefs({ appId: "app/a", refDomain: "doc" }), "listRootDomainRefs"],
    ["GET", appAdminRoutes.rootDomainEvents({ appId: "app/a", refDomain: "doc" }), "listRootDomainEvents"],
    ["GET", appAdminRoutes.platformInvitations(), "listPlatformInvitations"],
    ["POST", appAdminRoutes.platformInvitations(), "createPlatformInvitation"],
    ["DELETE", appAdminRoutes.platformInvitation({ invitationId: "invite/1" }), "revokePlatformInvitation"],
    ["POST", appAdminRoutes.acceptPlatformInvitation({ token: "tok/1" }), "acceptPlatformInvitation"],
    ["GET", appAdminRoutes.platformAuditEvents(), "listPlatformAuditEvents"],
    ["GET", appAdminRoutes.platformPrincipalAccess({ principalRef: "principal/1" }), "getPlatformAccess"],
    ["GET", appAdminRoutes.platformAccounts(), "listPlatformAccounts"],
    ["GET", appAdminRoutes.platformAccount({ accountId: "acct/a" }), "getPlatformAccount"],
    ["PUT", appAdminRoutes.platformAccountAuthority({ accountId: "acct/a", authority: "platform.admin" }), "grantPlatformAccountAuthority"],
    ["DELETE", appAdminRoutes.platformAccountAuthority({ accountId: "acct/a", authority: "apps.create" }), "revokePlatformAccountAuthority"],
    ["PUT", appAdminRoutes.platformAccountBlock({ accountId: "acct/a" }), "blockPlatformAccount"],
    ["DELETE", appAdminRoutes.platformAccountBlock({ accountId: "acct/a" }), "restorePlatformAccount"],
  ] as const)("matches %s %s -> %s", (method, pathname, operation) => {
    expect(matchAppAdminRoute(method, pathname)).toMatchObject({ operation });
  });

  test("encodes App path segments and returns appId", () => {
    const path = appAdminRoutes.rootDomainRefs({ appId: "app/a", refDomain: "doc:md" });
    expect(path).toBe("/admin/apps/app%2Fa/root-ref-domains/doc%3Amd/refs");
    expect(matchAppAdminRoute("GET", path)).toMatchObject({
      appId: "app/a",
      refDomain: "doc:md",
    });
  });

  test("keeps Stack and App scoped matchers disjoint", () => {
    const stackPath = casAdminRoutes.stack({ stackId: "scope-a" });
    const appPath = appAdminRoutes.app({ appId: "scope-a" });
    expect(matchAppAdminRoute("GET", stackPath)).toBeNull();
    expect(matchCasAdminRoute("GET", appPath)).toBeNull();
  });

  test("rejects data paths, malformed escapes, and wrong methods", () => {
    expect(matchAppAdminRoute("GET", "/v2/apps/a/spaces/s/cas/usage")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/apps/%ZZ")).toBeNull();
    expect(matchAppAdminRoute("POST", appAdminRoutes.me())).toBeNull();
    expect(matchAppAdminRoute("GET", appAdminRoutes.managedCapability({ appId: "a" }))).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/apps/a/playground/file-roots")).toBeNull();
    expect(matchAppAdminRoute("POST", "/admin/apps/a/playground/file-roots")).toBeNull();
    expect(matchAppAdminRoute("PATCH", "/admin/apps/a/playground/file-roots/r")).toBeNull();
    expect(matchAppAdminRoute("DELETE", "/admin/apps/a/playground/file-roots/r")).toBeNull();
  });
});
