import { afterAll, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "superset-cdp-registry-"));
const previousHome = process.env.SUPERSET_HOME_DIR;
process.env.SUPERSET_HOME_DIR = home;
const {
	proxyDirectory,
	tryProxyLock,
	readProxy,
	writeProxy,
	proxyProcessIsAlive,
} = await import("./registry");
const { cdpProxyId, ensureCdpProxy, stopCdpProxy } = await import("./client");
const { env } = await import("../env");
const options = {
	apiKey: ["sk", "test", "registry", "fixture"].join("_"),
	organizationId: "org",
	hostId: "host",
	workspaceId: "workspace",
	paneId: "pane",
	upstreamUrl: "ws://127.0.0.1:1/cdp?workspaceId=workspace",
};

afterAll(() => {
	process.env.SUPERSET_HOME_DIR = previousHome;
	rmSync(home, { recursive: true, force: true });
});

test("a crashed lock owner releases the startup transaction", async () => {
	const child = Bun.spawn(
		[process.execPath, join(import.meta.dir, "fixtures/lock.ts")],
		{
			env: { ...process.env, SUPERSET_HOME_DIR: home },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	try {
		await child.stdout.getReader().read();
		expect(tryProxyLock("a".repeat(64))).toBeNull();
		child.kill("SIGKILL");
		await child.exited;
		const release = tryProxyLock("a".repeat(64));
		expect(release).not.toBeNull();
		release?.();
		expect(
			statSync(join(proxyDirectory, "launch-lock.sqlite")).mode & 0o777,
		).toBe(0o600);
	} finally {
		if (child.exitCode === null) child.kill("SIGKILL");
		await child.exited;
	}
});

test("reuse identity isolates credentials, target routes and path-mounted API environments", () => {
	const original = env.SUPERSET_API_URL;
	try {
		env.SUPERSET_API_URL = "https://example.com/one/";
		const id = cdpProxyId(options);
		env.SUPERSET_API_URL = "https://example.com/one";
		expect(cdpProxyId(options)).toBe(id);
		env.SUPERSET_API_URL = "https://example.com/two";
		expect(cdpProxyId(options)).not.toBe(id);
		env.SUPERSET_API_URL = "https://example.com/one";
		for (const key of [
			"apiKey",
			"organizationId",
			"hostId",
			"workspaceId",
			"paneId",
			"upstreamUrl",
		] as const) {
			expect(
				cdpProxyId({ ...options, [key]: `${options[key]}other` }),
			).not.toBe(id);
		}
	} finally {
		env.SUPERSET_API_URL = original;
	}
});

test("concurrent exports reuse one daemon and uncertain health retains its management handle", async () => {
	const [first, second] = await Promise.all([
		ensureCdpProxy(options),
		ensureCdpProxy(options),
	]);
	const manifest = readProxy(first.proxyId)!;
	try {
		expect(first).toEqual(second);
		expect(await proxyProcessIsAlive(manifest)).toBe(true);
		expect(
			statSync(join(proxyDirectory, `${manifest.id}.json`)).mode & 0o777,
		).toBe(0o600);
		writeProxy({ ...manifest, stopToken: "e".repeat(64) });
		await expect(ensureCdpProxy(options)).rejects.toThrow("not responding");
		await expect(stopCdpProxy(manifest.id)).rejects.toThrow("Could not stop");
		expect(readProxy(manifest.id)?.pid).toBe(manifest.pid);
		writeProxy(manifest);
		expect(
			readFileSync(join(proxyDirectory, `${manifest.id}.json`), "utf8"),
		).not.toContain(options.apiKey);
	} finally {
		writeProxy(manifest);
		await stopCdpProxy(manifest.id);
	}
	expect(await proxyProcessIsAlive(manifest)).toBe(false);
	expect(readProxy(manifest.id)).toBeNull();
});

test("manifest identity is bound to its filename and stale PIDs cannot stop unrelated processes", async () => {
	const id = cdpProxyId(options);
	const manifest = {
		id,
		pid: process.pid,
		instance: "d".repeat(64),
		endpoint: "http://127.0.0.1:1",
		token: "b".repeat(64),
		stopToken: "c".repeat(64),
	};
	writeProxy(manifest);
	expect(await proxyProcessIsAlive(manifest)).toBe(false);
	expect(await stopCdpProxy(id)).toBe(true);
	writeFileSync(
		join(proxyDirectory, `${id}.json`),
		JSON.stringify({ ...manifest, id: "e".repeat(64) }),
	);
	expect(readProxy(id)).toBeNull();
});
