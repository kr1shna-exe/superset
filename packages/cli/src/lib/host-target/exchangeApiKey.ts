import { CLIError } from "@superset/cli-framework";
import { z } from "zod";
import { env } from "../env";

const tokenResponse = z.object({ token: z.string().trim().min(1) });

export async function exchangeApiKey(bearer: string): Promise<string> {
	if (!bearer.startsWith("sk_live_")) return bearer;

	let response: Response;
	try {
		response = await fetch(`${env.SUPERSET_API_URL}/api/auth/token`, {
			headers: { "x-api-key": bearer },
			signal: AbortSignal.timeout(10_000),
			redirect: "error",
		});
	} catch {
		throw new CLIError(
			"Could not exchange API key for remote host access",
			"Check connectivity to the Superset API and try again",
		);
	}
	if (!response.ok) {
		throw new CLIError(
			`Could not exchange API key for remote host access (HTTP ${response.status})`,
			response.status === 401 || response.status === 403
				? "Check --api-key or SUPERSET_API_KEY"
				: "Check the Superset API and try again",
		);
	}

	const parsed = tokenResponse.safeParse(
		await response.json().catch(() => null),
	);
	if (!parsed.success) {
		throw new CLIError("Superset API returned an invalid remote host token");
	}
	return parsed.data.token;
}
