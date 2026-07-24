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
	it("replaces the immutable jira:// handler when extensions reload", () => {
		const tools: string[] = [];
		jiraExtension(extensionApi(tools));
		const router = InternalUrlRouter.instance();
		const firstHandler = router.getHandler("jira");

		expect(firstHandler?.immutable).toBe(true);
		expect(tools).toEqual(["jira"]);

		jiraExtension(extensionApi(tools));
		const reloadedHandler = router.getHandler("jira");

		expect(reloadedHandler).not.toBe(firstHandler);
		expect(reloadedHandler?.immutable).toBe(true);
		expect(tools).toEqual(["jira", "jira"]);
		expect(router.getHandler("jira")).toBe(reloadedHandler);
	});
});
