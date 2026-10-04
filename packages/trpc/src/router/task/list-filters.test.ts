import { Database, type SQLQueryBindings } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { tasks } from "@superset/db/schema";
import { and, asc } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { buildTaskListFilters } from "./list-filters";
import type { TaskListFilterInput } from "./schema";

let db: Database;

function list(input: TaskListFilterInput, userId = "me") {
	const query = new QueryBuilder()
		.select({ id: tasks.id })
		.from(tasks)
		.where(and(...buildTaskListFilters("org", userId, input)))
		.orderBy(asc(tasks.id))
		.toSQL();
	return db
		.query<{ id: string }, SQLQueryBindings[]>(query.sql)
		.all(...(query.params as SQLQueryBindings[]))
		.map((row) => row.id);
}

beforeEach(() => {
	db = new Database(":memory:");
	db.exec(`
		ATTACH DATABASE ':memory:' AS auth;
		CREATE TABLE auth.accounts (user_id TEXT, provider_id TEXT, account_id TEXT);
		CREATE TABLE tasks (
			id TEXT, organization_id TEXT, deleted_at TEXT, assignee_id TEXT,
			external_provider TEXT, assignee_external_id TEXT, status_id TEXT
		);
		INSERT INTO auth.accounts VALUES
			('me', 'linear', 'linear-me'),
			('me', 'linear', 'linear-me'),
			('me', 'linear', 'linear-me-second'),
			('me', 'google', 'google-me'),
			('other', 'linear', 'linear-other');
		INSERT INTO tasks VALUES
			('native', 'org', NULL, 'me', NULL, NULL, 'started'),
			('linear', 'org', NULL, NULL, 'linear', 'linear-me', 'started'),
			('second', 'org', NULL, NULL, 'linear', 'linear-me-second', 'backlog'),
			('other-user', 'org', NULL, 'other', 'linear', 'linear-other', 'started'),
			('other-org', 'another-org', NULL, NULL, 'linear', 'linear-me', 'started'),
			('deleted', 'org', '2026-01-01', NULL, 'linear', 'linear-me', 'started'),
			('other-provider', 'org', NULL, NULL, 'github', 'linear-me', 'started'),
			('other-account', 'org', NULL, NULL, 'linear', 'google-me', 'started'),
			('unassigned', 'org', NULL, NULL, NULL, NULL, 'started');
	`);
});

afterEach(() => db.close());

describe("buildTaskListFilters", () => {
	test("includes native and linked Linear assignments once within the organization", () => {
		expect(list({ assigneeMe: true })).toEqual(["linear", "native", "second"]);
	});

	test("applies other filters to both assignment sources", () => {
		expect(list({ assigneeMe: true, statusId: "started" })).toEqual([
			"linear",
			"native",
		]);
	});

	test("keeps explicit assignee IDs restricted to Superset users", () => {
		expect(list({ assigneeId: "me" })).toEqual(["native"]);
		expect(list({ assigneeId: "linear-me" })).toEqual([]);
	});

	test("gives assigneeMe precedence over an explicit assignee", () => {
		expect(list({ assigneeMe: true, assigneeId: "other" })).toEqual([
			"linear",
			"native",
			"second",
		]);
	});

	test("keeps native assignments when no Linear identity is linked", () => {
		db.run("DELETE FROM auth.accounts WHERE user_id = ?", ["me"]);
		expect(list({ assigneeMe: true })).toEqual(["native"]);
	});

	test("does not filter by the caller when assigneeMe is false or omitted", () => {
		const expected = [
			"linear",
			"native",
			"other-account",
			"other-provider",
			"other-user",
			"second",
			"unassigned",
		];
		expect(list({ assigneeMe: false })).toEqual(expected);
		expect(list({})).toEqual(expected);
	});
});
