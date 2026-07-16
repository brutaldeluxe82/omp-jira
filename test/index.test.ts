import { afterEach, describe, expect, it } from "bun:test";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import jiraExtension from "../src/index";

function extensionApi(tools: string[]): never {
	const schema = {
		describe: () => schema,
		optional: () => schema,
		nullable: () => schema,
	};
	const z = {
		object: () => schema,
		enum: () => schema,
		string: () => schema,
		boolean: () => schema,
		array: () => schema,
	};
	return { zod: { z }, registerTool: (tool: { name: string }) => tools.push(tool.name) } as never;
}

afterEach(() => InternalUrlRouter.resetForTests());

describe("Jira extension", () => {
	it("registers one immutable jira:// handler and the jira dispatcher", () => {
		const tools: string[] = [];
		jiraExtension(extensionApi(tools));
		const router = InternalUrlRouter.instance();
		const handler = router.getHandler("jira");

		expect(handler?.immutable).toBe(true);
		expect(tools).toEqual(["jira"]);
		jiraExtension(extensionApi(tools));
		expect(router.getHandler("jira")).toBe(handler);
	});
});
