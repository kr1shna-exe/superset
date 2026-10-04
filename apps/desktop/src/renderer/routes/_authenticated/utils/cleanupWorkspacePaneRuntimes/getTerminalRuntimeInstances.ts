import type { WorkspaceState } from "@superset/panes";
import type { PaneLifecycleRow } from "renderer/routes/_authenticated/components/utils/paneLifecycleRows";

export function getTerminalRuntimeInstances(rows: PaneLifecycleRow[]) {
	const instances = new Map<string, string>();
	for (const row of rows) {
		const layout = row.paneLayout as WorkspaceState<unknown> | undefined;
		for (const tab of layout?.tabs ?? []) {
			for (const pane of Object.values(tab.panes)) {
				if (
					pane.kind !== "terminal" ||
					!pane.data ||
					typeof pane.data !== "object"
				)
					continue;
				const data = pane.data as { terminalId?: unknown };
				if (typeof data.terminalId === "string")
					instances.set(pane.id, data.terminalId);
			}
		}
	}
	return instances;
}
