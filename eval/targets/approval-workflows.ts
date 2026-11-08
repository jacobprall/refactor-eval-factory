import { type EvalTarget, seedFiles } from "./types.js";

const source = `export type Status = "draft" | "submitted" | "approved" | "rejected";
export function submit(status: Status): Status {
  if (status !== "draft") throw new Error("only drafts can be submitted");
  return "submitted";
}
`;
const tests = `import test from "node:test"; import assert from "node:assert/strict";
import { submit } from "../src/index.ts";
test("submits drafts",()=>assert.equal(submit("draft"),"submitted"));
`;

export const approvalWorkflows: EvalTarget = {
	id: "approval-workflows",
	title: "Approval workflows",
	files: seedFiles("approval-workflows", source, tests),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "request",
			title: "Approval requests",
			prompt:
				"Add ApprovalRequest with id, status, submit(), approve(actor), and reject(actor, reason). Enforce valid transitions and preserve rejection reason.",
			hiddenTest: `test("enforces request transitions",()=>{ const r=new subject.ApprovalRequest("1"); r.submit(); r.approve("alice"); assert.equal(r.status,"approved"); assert.throws(()=>r.reject("bob","late")); });`,
		},
		{
			id: "roles",
			title: "Role requirements",
			prompt:
				"Approvers now have roles. Each request declares a requiredRole. approve and reject receive an actor with id and roles and must authorize the action.",
			hiddenTest: `test("requires an approver role",()=>{ const r=new subject.ApprovalRequest("1","finance"); r.submit(); assert.throws(()=>r.approve({id:"a",roles:["legal"]})); r.approve({id:"b",roles:["finance"]}); });`,
		},
		{
			id: "two-stage",
			title: "Two-stage approval",
			prompt: "Support an ordered list of required roles. Each role must approve once in order; status becomes approved only after the final stage.",
			hiddenTest: `test("approves stages in order",()=>{ const r=new subject.ApprovalRequest("1",["manager","finance"]); r.submit(); r.approve({id:"m",roles:["manager"]}); assert.equal(r.status,"submitted"); assert.throws(()=>r.approve({id:"m",roles:["manager"]})); r.approve({id:"f",roles:["finance"]}); assert.equal(r.status,"approved"); });`,
		},
		{
			id: "delegation",
			title: "Delegated approval",
			prompt:
				"Allow an actor to delegate one of their roles to another actor until a timestamp. Approval receives now and accepts active delegation, recording both delegate and delegator.",
			hiddenTest: `test("uses active delegation",()=>{ const r=new subject.ApprovalRequest("1",["finance"]); r.delegate("boss","helper","finance",20); r.submit(); r.approve({id:"helper",roles:[]},10); assert.equal(r.status,"approved"); });`,
		},
		{
			id: "withdraw",
			title: "Withdrawal and resubmission",
			prompt:
				"Add withdraw(actorId) for submitted requests. Withdrawal clears prior stage approvals and permits resubmission; approved and rejected requests cannot be withdrawn.",
			hiddenTest: `test("withdraws and resets",()=>{ const r=new subject.ApprovalRequest("1",["manager","finance"]); r.submit(); r.approve({id:"m",roles:["manager"]},0); r.withdraw("owner"); assert.equal(r.status,"draft"); r.submit(); assert.throws(()=>r.approve({id:"f",roles:["finance"]},0)); });`,
		},
		{
			id: "deadline",
			title: "Approval deadlines",
			prompt:
				"Requests may have a deadline. submit and approve receive now; actions after the deadline fail. Add expire(now), transitioning overdue submitted requests to expired.",
			hiddenTest: `test("expires overdue requests",()=>{ const r=new subject.ApprovalRequest("1",["manager"],10); r.submit(1); assert.equal(r.expire(11),true); assert.equal(r.status,"expired"); });`,
		},
		{
			id: "conditions",
			title: "Conditional stages",
			prompt:
				"Required approval stages can include minAmount. Construct requests with amount; skip stages whose threshold is greater than the amount.",
			hiddenTest: `test("skips inapplicable stages",()=>{ const r=new subject.ApprovalRequest("1",[{role:"manager",minAmount:0},{role:"cfo",minAmount:10000}],undefined,500); r.submit(0); r.approve({id:"m",roles:["manager"]},0); assert.equal(r.status,"approved"); });`,
		},
		{
			id: "history",
			title: "Decision history",
			prompt:
				"Add history() returning immutable chronological events for submit, stage approval, rejection, withdrawal, expiration, and delegation, including actor and timestamp where applicable.",
			hiddenTest: `test("records immutable history",()=>{ const r=new subject.ApprovalRequest("1",["manager"]); r.submit(1); r.approve({id:"m",roles:["manager"]},2); const h=r.history(); assert.deepEqual(h.map((e:any)=>e.type),["submit","approve"]); h.length=0; assert.equal(r.history().length,2); });`,
		},
	],
};
