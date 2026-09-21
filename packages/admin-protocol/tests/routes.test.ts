import { describe, expect, test } from "vitest";
import {
  appAdminRoutes,
  matchAppAdminRoute,
} from "../src/index.js";

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
    ["GET", appAdminRoutes.usage({ appId: "app/a" }), "getUsage"],
    ["GET", appAdminRoutes.members({ appId: "app/a" }), "listMembers"],
    ["DELETE", appAdminRoutes.members({ appId: "app/a" }), "deleteMember"],
    ["POST", appAdminRoutes.memberInvitations({ appId: "app/a" }), "createMemberInvitation"],
    ["POST", appAdminRoutes.acceptMemberInvitation({ token: "tok/1" }), "acceptMemberInvitation"],
    ["GET", appAdminRoutes.oauthIssuer({ appId: "app/a" }), "getOAuthIssuer"],
    ["PUT", appAdminRoutes.oauthIssuer({ appId: "app/a" }), "activateOAuthIssuer"],
    ["POST", appAdminRoutes.oauthIssuerInspections({ appId: "app/a" }), "inspectOAuthIssuer"],
    ["GET", appAdminRoutes.refDomains({ appId: "app/a" }), "listRefDomains"],
    ["GET", appAdminRoutes.controlAuditEvents({ appId: "app/a" }), "listControlAuditEvents"],
    ["GET", appAdminRoutes.rootDomainRefs({ appId: "app/a", refDomain: "doc" }), "listRootDomainRefs"],
    ["GET", appAdminRoutes.rootDomainEvents({ appId: "app/a", refDomain: "doc" }), "listRootDomainEvents"],
    ["GET", appAdminRoutes.platformInvitations(), "listPlatformInvitations"],
    ["POST", appAdminRoutes.platformInvitations(), "createPlatformInvitation"],
    ["DELETE", appAdminRoutes.platformInvitation({ invitationId: "invite/1" }), "revokePlatformInvitation"],
    ["POST", appAdminRoutes.acceptPlatformInvitation({ token: "tok/1" }), "acceptPlatformInvitation"],
    ["GET", appAdminRoutes.platformAuditEvents(), "listPlatformAuditEvents"],
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

  test("rejects retired Stack administrator paths", () => {
    expect(matchAppAdminRoute("GET", "/admin/stacks/scope-a")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/stacks/scope-a/members")).toBeNull();
  });

  test("rejects retired Principal-keyed platform routes", () => {
    expect(matchAppAdminRoute("GET", "/admin/platform/access-summary")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/platform/principals")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/platform/principals/prn_1")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/platform/principals/prn_1/access")).toBeNull();
    expect(matchAppAdminRoute("PATCH", "/admin/platform/principals/prn_1/access")).toBeNull();
  });

  test("rejects data paths, malformed escapes, and wrong methods", () => {
    expect(matchAppAdminRoute("GET", "/v1/apps/a/spaces/s/cas/usage")).toBeNull();
    expect(matchAppAdminRoute("GET", "/admin/apps/%ZZ")).toBeNull();
    expect(matchAppAdminRoute("POST", appAdminRoutes.me())).toBeNull();
    expect(matchAppAdminRoute("POST", "/admin/apps/a/managed-capabilities")).toBeNull();
  });
});
