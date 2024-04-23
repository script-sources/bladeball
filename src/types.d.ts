declare global {
	interface _G {
		bladeball?: true;
	}

	interface Workspace {
		Alive: Folder;
		Dead: Folder;
	}
}

export type Node = { next?: Node; item: Destructible };
export type Destructible = (() => unknown) | RBXScriptConnection | thread | { destroy(): void } | { Destroy(): void };
