import { tasks, userIdentities } from "@superset/db/schema";
import {
	buildTaskListConditions,
	InvalidDueDateRangeError,
	normalizeDueDateRange,
} from "@superset/db/task-list-query";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, or } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import type { TaskListFilterInput } from "./schema";

export function buildTaskListFilters(
	organizationId: string,
	userId: string,
	input: TaskListFilterInput | null | undefined,
) {
	let dueDateRange: { from?: Date; to?: Date };
	try {
		dueDateRange = normalizeDueDateRange(
			input?.dueDateFrom ?? undefined,
			input?.dueDateTo ?? undefined,
		);
	} catch (error) {
		if (error instanceof InvalidDueDateRangeError) {
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		}
		throw error;
	}

	const filters = buildTaskListConditions({
		organizationId,
		nativeOnly: input?.nativeOnly ?? undefined,
		statusId: input?.statusId ?? undefined,
		priority: input?.priority ?? undefined,
		assigneeId: input?.assigneeMe
			? undefined
			: (input?.assigneeId ?? undefined),
		creatorId: input?.creatorMe ? userId : undefined,
		search: input?.search ?? undefined,
		externalProjectId: input?.externalProjectId ?? undefined,
		externalProjectName: input?.externalProjectName ?? undefined,
		externalCycleId: input?.externalCycleId ?? undefined,
		dueDateFrom: dueDateRange.from,
		dueDateTo: dueDateRange.to,
	});

	if (input?.assigneeMe) {
		const linearIdentityIds = new QueryBuilder()
			.select({ externalId: userIdentities.externalId })
			.from(userIdentities)
			.where(
				and(
					eq(userIdentities.organizationId, organizationId),
					eq(userIdentities.userId, userId),
					eq(userIdentities.provider, "linear"),
				),
			);
		const assigneeFilter = or(
			eq(tasks.assigneeId, userId),
			and(
				eq(tasks.externalProvider, "linear"),
				inArray(tasks.assigneeExternalId, linearIdentityIds),
			),
		);
		if (assigneeFilter) filters.push(assigneeFilter);
	}

	return filters;
}
