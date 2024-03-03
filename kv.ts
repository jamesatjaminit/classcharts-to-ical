import { encodeHex } from "./deps.ts";

const kv = await Deno.openKv();

export async function checkAndAddRateLimit(bucket: string, identifier: string, allowedRequests: number, inTime: number): Promise<boolean> {
	const codeBuffer = new TextEncoder().encode(identifier);
	const hashBuffer = await crypto.subtle.digest("SHA-512", codeBuffer);
	const hex = encodeHex(hashBuffer);
	const keys = kv.list<string>({ prefix: ["rateLimit", bucket, hex] });
	let numberOfRequests = 0;
	for await (const _ of keys) numberOfRequests++;
	if (numberOfRequests >= allowedRequests) {
		return false;
	}

	await kv.set(["rateLimit", bucket, hex, crypto.randomUUID()], "limited", {
		expireIn: inTime
	});
	return true;
}