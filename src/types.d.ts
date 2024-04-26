declare global {
	interface _G {
		bladeball?: true;
	}

	interface Workspace {
		Alive: Folder;
		Dead: Folder;
	}

	interface ReplicatedStorage {
		Remotes: Folder & {
			VisualCD: RemoteEvent<(arg0: boolean, arg1: boolean, cooldown: number) => void>;
			ParrySuccess: RemoteEvent<() => void>;
			ParryAttempt: RemoteEvent<(_: Part) => void>;
		};
	}
}

export type Node = { next?: Node; item: Destructible };
export type Destructible = (() => unknown) | RBXScriptConnection | thread | { destroy(): void } | { Destroy(): void };
