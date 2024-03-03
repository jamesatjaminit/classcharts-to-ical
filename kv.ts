import { encodeHex } from "./deps.ts";

const kv = await Deno.openKv();

export async function checkAndAddRateLimit(bucket: string, identifier: string, timeUntilNextRequest: number): Promise<boolean> {
	const codeBuffer = new TextEncoder().encode(identifier);
	const hashBuffer = await crypto.subtle.digest("SHA-512", codeBuffer);
	const hex = encodeHex(hashBuffer);
	const existingKey = await kv.get(["rateLimit", bucket, hex]);
	if (existingKey.value !== null) {
		return false;
	}
	await kv.set(["rateLimit", bucket, hex], "limited", {
		expireIn: timeUntilNextRequest
	});
	return true;
}