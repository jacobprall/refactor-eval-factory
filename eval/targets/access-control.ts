import { type EvalTarget, seedFiles } from "./types.js";

const source = `export interface User { id: string; role: "viewer" | "editor" }
export function canEdit(user: User): boolean { return user.role === "editor"; }
`;
const tests = `import test from "node:test"; import assert from "node:assert/strict";
import { canEdit } from "../src/index.ts";
test("editors edit",()=>assert.equal(canEdit({id:"1",role:"editor"}),true));
`;

export const accessControl: EvalTarget = {
	id: "access-control",
	title: "Access control",
	files: seedFiles("access-control", source, tests),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "permissions",
			title: "Role permissions",
			prompt: "Add authorize(user, action) for read, edit, and delete. Viewers read; editors read/edit; admins can do all actions.",
			hiddenTest: `test("authorizes roles",()=>{ assert.equal(subject.authorize({id:"1",role:"viewer"},"edit"),false); assert.equal(subject.authorize({id:"2",role:"admin"},"delete"),true); });`,
		},
		{
			id: "ownership",
			title: "Resource ownership",
			prompt: "Resources have ownerId. Editors may edit only resources they own; admins remain unrestricted. Extend authorize with a resource.",
			hiddenTest: `test("checks ownership",()=>{ assert.equal(subject.authorize({id:"1",role:"editor"},"edit",{ownerId:"1"}),true); assert.equal(subject.authorize({id:"1",role:"editor"},"edit",{ownerId:"2"}),false); });`,
		},
		{
			id: "teams",
			title: "Team membership",
			prompt: "Users and resources may share team ids. Editors may edit resources owned by one of their teams. Preserve direct ownership.",
			hiddenTest: `test("checks team membership",()=>assert.equal(subject.authorize({id:"1",role:"editor",teamIds:["t"]},"edit",{ownerId:"2",teamId:"t"}),true));`,
		},
		{
			id: "sensitivity",
			title: "Sensitivity levels",
			prompt:
				"Resources have sensitivity public, internal, or confidential. Users have clearance 0..2. Reading requires matching clearance; ownership never bypasses clearance.",
			hiddenTest: `test("enforces clearance",()=>assert.equal(subject.authorize({id:"1",role:"admin",clearance:1},"read",{ownerId:"1",sensitivity:"confidential"}),false));`,
		},
		{
			id: "time-bound",
			title: "Temporary grants",
			prompt:
				"Support temporary grants containing userId, action, resourceId, and expiresAt. authorize receives now and grants; an active exact grant permits the action after clearance checks.",
			hiddenTest: `test("uses active grants",()=>assert.equal(subject.authorize({id:"1",role:"viewer",clearance:2},"edit",{id:"r",ownerId:"2",sensitivity:"public"},5,[{userId:"1",action:"edit",resourceId:"r",expiresAt:10}]),true));`,
		},
		{
			id: "deny",
			title: "Explicit deny policies",
			prompt:
				"Support deny policies by user, action, and optional resource id. Matching denies override roles, ownership, teams, and temporary grants.",
			hiddenTest: `test("deny overrides grants",()=>assert.equal(subject.authorize({id:"1",role:"admin",clearance:2},"delete",{id:"r",ownerId:"1",sensitivity:"public"},0,[],[{userId:"1",action:"delete"}]),false));`,
		},
		{
			id: "organization",
			title: "Organization boundaries",
			prompt:
				"Users and resources belong to organizations. Deny cross-organization access before evaluating other rules, except admins with crossOrg=true.",
			hiddenTest: `test("isolates organizations",()=>{ assert.equal(subject.authorize({id:"1",role:"admin",clearance:2,orgId:"a"},"read",{id:"r",ownerId:"1",sensitivity:"public",orgId:"b"}),false); });`,
		},
		{
			id: "decision",
			title: "Explain authorization",
			prompt:
				"Add authorizeDecision returning {allowed, reason}. Reasons distinguish organization, clearance, explicit-deny, temporary-grant, role, ownership, team, and insufficient-permission. authorize must delegate to the same rules.",
			hiddenTest: `test("explains decisions",()=>{ const d=subject.authorizeDecision({id:"1",role:"viewer",clearance:0,orgId:"a"},"edit",{id:"r",ownerId:"2",sensitivity:"public",orgId:"a"}); assert.deepEqual(d,{allowed:false,reason:"insufficient-permission"}); });`,
		},
	],
};
