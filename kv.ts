import { encodeHex } from "./deps.ts";
import { hash } from "@denosaurs/argontwo";

const kv = await Deno.openKv();

export async function checkAndAddRateLimit(
	bucket: string,
	identifier: string,
	allowedRequests: number,
	inTime: number,
): Promise<boolean> {
	const codeBuffer = new TextEncoder().encode(identifier);
	const array = new TextEncoder().encode("classcharts-api-ical"); // I realise a salt is supposed to be random, however it isn't possible here, but I believe the security tradeoff is minimal for the usecase of just storing dob and code
	const hashBuffer = hash(codeBuffer, array);
	const hex = encodeHex(hashBuffer);
	const keys = kv.list<string>({ prefix: ["rateLimit", bucket, hex] });
	let numberOfRequests = 0;
	for await (const _ of keys) numberOfRequests++;
	if (numberOfRequests >= allowedRequests) {
		return false;
	}
	await kv.set(["rateLimit", bucket, hex, crypto.randomUUID()], "limited", {
		expireIn: inTime,
	});
	return true;
}
