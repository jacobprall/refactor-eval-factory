import { type EvalTarget, seedFiles } from "./types.js";

const source = `export interface Event { start: number; end: number }
export function overlaps(a: Event, b: Event): boolean { return a.start < b.end && b.start < a.end; }
`;
const tests = `import test from "node:test"; import assert from "node:assert/strict";
import { overlaps } from "../src/index.ts";
test("detects overlap",()=>assert.equal(overlaps({start:0,end:2},{start:1,end:3}),true));
`;

export const eventScheduling: EvalTarget = {
	id: "event-scheduling",
	title: "Event scheduling",
	files: seedFiles("event-scheduling", source, tests),
	publicVerify: ["npm test"],
	steps: [
		{
			id: "calendar",
			title: "Calendar booking",
			prompt: "Add Calendar with book(id, start, end) and list(). Reject invalid ranges, duplicate ids, and overlapping bookings.",
			hiddenTest: `test("books non-overlapping events",()=>{ const c=new subject.Calendar(); c.book("a",0,2); c.book("b",2,3); assert.throws(()=>c.book("c",1,4)); });`,
		},
		{
			id: "capacity",
			title: "Capacity-limited events",
			prompt:
				"Bookings have capacity and attendees. Add register(eventId, attendeeId) and unregister. Reject duplicates and registration beyond capacity.",
			hiddenTest: `test("enforces capacity",()=>{ const c=new subject.Calendar(); c.book("a",0,2,1); c.register("a","u"); assert.throws(()=>c.register("a","v")); c.unregister("a","u"); });`,
		},
		{
			id: "waitlist",
			title: "Waitlists",
			prompt:
				"When an event is full, register adds the attendee to a FIFO waitlist and reports 'waitlisted'. unregister promotes the next attendee. Add event(id) snapshot.",
			hiddenTest: `test("promotes waitlists",()=>{ const c=new subject.Calendar(); c.book("a",0,2,1); c.register("a","u"); assert.equal(c.register("a","v"),"waitlisted"); c.unregister("a","u"); assert.deepEqual(c.event("a").attendees,["v"]); });`,
		},
		{
			id: "rooms",
			title: "Room scheduling",
			prompt:
				"Bookings require a room id. Overlap is forbidden only within the same room. list may be filtered by room. Existing calls use room 'default'.",
			hiddenTest: `test("isolates rooms",()=>{ const c=new subject.Calendar(); c.book("a",0,2,1,"x"); c.book("b",0,2,1,"y"); assert.equal(c.list("x").length,1); });`,
		},
		{
			id: "recurrence",
			title: "Recurring events",
			prompt:
				"Add bookRecurring(idPrefix, start, end, interval, count, capacity, room). Create all occurrences atomically or none when any conflicts.",
			hiddenTest: `test("books recurring events atomically",()=>{ const c=new subject.Calendar(); c.bookRecurring("standup",0,1,7,3,2,"x"); assert.deepEqual(c.list("x").map((e:any)=>e.id),["standup-1","standup-2","standup-3"]); });`,
		},
		{
			id: "reschedule",
			title: "Rescheduling",
			prompt:
				"Add reschedule(eventId, start, end, room). Preserve attendees and waitlist. Validate conflicts atomically and leave the original unchanged on failure.",
			hiddenTest: `test("reschedules atomically",()=>{ const c=new subject.Calendar(); c.book("a",0,1,2,"x"); c.book("b",2,3,2,"x"); assert.throws(()=>c.reschedule("a",2,4,"x")); assert.equal(c.event("a").start,0); });`,
		},
		{
			id: "cancellation",
			title: "Cancellation policy",
			prompt:
				"Add cancel(eventId, now). Events cannot be cancelled at or after start. Return affected attendees and waitlisted users and remove the event.",
			hiddenTest: `test("cancels future events",()=>{ const c=new subject.Calendar(); c.book("a",10,11,1); c.register("a","u"); assert.deepEqual(c.cancel("a",9).attendees,["u"]); assert.throws(()=>c.event("a")); });`,
		},
		{
			id: "availability",
			title: "Availability search",
			prompt:
				"Add availableRooms(start, end, roomIds), returning rooms without conflicts in input order. It must use the same overlap rules as booking and rescheduling.",
			hiddenTest: `test("finds available rooms",()=>{ const c=new subject.Calendar(); c.book("a",0,2,1,"x"); assert.deepEqual(c.availableRooms(1,3,["x","y"]),["y"]); });`,
		},
	],
};
