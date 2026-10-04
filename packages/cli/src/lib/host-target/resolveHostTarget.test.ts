import { afterAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createApiClient } from "../api-client";
import { env } from "../env";
import { resolveHostTarget } from "./resolveHostTarget";

const apiKey = ["sk", "live", "remote", "host", "fixture"].join("_");
const jwt = "header.payload.signature";
const requests: { url: string; headers: Headers }[] = [];
let tokenResponse = () => Response.json({ token: jwt });
const server = Bun.serve({
	port: 0,
	fetch(request, server): Response {
		requests.push({ url: request.url, headers: new Headers(request.headers) });
		const url = new URL(request.url);
		if (url.pathname === "/api/auth/token") return tokenResponse();
		if (url.pathname === "/api/trpc/host.relayEndpoint") {
			return Response.json([
				{ result: { data: { json: { url: server.url.origin } } } },
			]);
		}
		return Response.json([{ result: { data: { json: [] } } }]);
	},
});
const originalApiUrl = env.SUPERSET_API_URL;

beforeEach(() => {
	env.SUPERSET_API_URL = server.url.origin;
	requests.length = 0;
	tokenResponse = () => Response.json({ token: jwt });
});

afterAll(() => {
	env.SUPERSET_API_URL = originalApiUrl;
	server.stop(true);
});

function resolve(bearer = apiKey) {
	return resolveHostTarget({
		requestedHostId: "remote-host-fixture",
		organizationId: "org-fixture",
		userJwt: bearer,
		api: createApiClient({ bearer, organizationId: "org-fixture" }),
	});
}

describe("resolveHostTarget remote authentication", () => {
	test("exchanges an API key for HTTP and WebSocket credentials", async () => {
		const target = await resolve();
		expect(await target.client.workspace.list.query()).toEqual([]);
		const exchange = requests.find((request) =>
			request.url.endsWith("/api/auth/token"),
		);
		expect(exchange?.headers.get("x-api-key")).toBe(apiKey);
		expect(exchange?.headers.get("authorization")).toBeNull();
		const hostRequest = requests.find((request) =>
			new URL(request.url).pathname.startsWith("/hosts/"),
		);
		expect(hostRequest?.headers.get("authorization")).toBe(`Bearer ${jwt}`);
		expect(hostRequest?.headers.get("x-api-key")).toBeNull();
		expect(target.ws.token).toBe(jwt);
	});

	test("passes OAuth JWTs through without an exchange", async () => {
		const target = await resolve(jwt);
		await target.client.workspace.list.query();
		expect(
			requests.some((request) => request.url.endsWith("/api/auth/token")),
		).toBe(false);
		expect(requests.at(-1)?.headers.get("authorization")).toBe(`Bearer ${jwt}`);
		expect(target.ws.token).toBe(jwt);
	});

	test("reports rejected keys before contacting the relay", async () => {
		tokenResponse = () =>
			new Response("private error details", { status: 401 });
		await expect(resolve()).rejects.toThrow(
			"Could not exchange API key for remote host access (HTTP 401)",
		);
		expect(requests).toHaveLength(1);
	});

	test.each([
		{},
		{ token: 123 },
		{ token: "   " },
		null,
	])("rejects an invalid token response: %j", async (body) => {
		tokenResponse = () => Response.json(body);
		await expect(resolve()).rejects.toThrow(
			"Superset API returned an invalid remote host token",
		);
		expect(requests).toHaveLength(1);
	});

	test("does not forward the API key through a redirect", async () => {
		tokenResponse = () => Response.redirect(`${server.url.origin}/other`, 302);
		await expect(resolve()).rejects.toThrow(
			"Could not exchange API key for remote host access",
		);
		expect(requests).toHaveLength(1);
	});

	test("bounds token exchange with an abort signal", async () => {
		const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(
			AbortSignal.abort(new DOMException("Timed out", "TimeoutError")),
		);
		try {
			await expect(resolve()).rejects.toThrow(
				"Could not exchange API key for remote host access",
			);
			expect(timeout).toHaveBeenCalledWith(10_000);
			expect(requests).toHaveLength(0);
		} finally {
			timeout.mockRestore();
		}
	});
});
