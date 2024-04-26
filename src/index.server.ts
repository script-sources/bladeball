import { Players, RunService, Workspace } from "@rbxts/services";
import { Destructible, Node } from "types";

if (_G["bladeball"]) throw "This program is already running!";
_G["bladeball"] = true;

/************************************************************
 * CONFIGURATIONS
 * Description: User-defined settings and configurations
 * Last updated: Feb. 14, 2024
 ************************************************************/
const RADIUS = 21;
const HEIGHT = 21;
const COMPENSATION = 200 / 1000; // (ms / 1000)

/************************************************************
 * VARIABLES
 * Description: Variables referenced globally in the script
 * Last updated: Feb. 14, 2024
 ************************************************************/
const LocalPlayer = Players.LocalPlayer;

let gravity = Workspace.Gravity;

/************************************************************
 * UTILITIES
 * Description: Helper functions and classes
 * Last updated: Feb. 14, 2024
 ************************************************************/
class Bin {
	private head: Node | undefined;
	private tail: Node | undefined;

	/**
	 * Adds an item into the Bin. This can be a:
	 * - `() => unknown`
	 * - RBXScriptConnection
	 * - thread
	 * - Object with `.destroy()` or `.Destroy()`
	 */
	public add<T extends Destructible>(item: T): T {
		const node: Node = { item };
		this.head ??= node;
		if (this.tail) this.tail.next = node;
		this.tail = node;
		return item;
	}

	/**
	 * Adds multiple items into the Bin. This can be a:
	 * - `() => unknown`
	 * - RBXScriptConnection
	 * - thread
	 * - Object with `.destroy()` or `.Destroy()`
	 */
	public batch<T extends Destructible[]>(...args: T): T {
		for (const item of args) {
			const node: Node = { item };
			this.head ??= node;
			if (this.tail) this.tail.next = node;
			this.tail = node;
		}
		return args;
	}

	/**
	 * Destroys all items currently in the Bin:
	 * - Functions will be called
	 * - RBXScriptConnections will be disconnected
	 * - threads will be `task.cancel()`-ed
	 * - Objects will be `.destroy()`-ed
	 */
	public destroy(): void {
		while (this.head) {
			const item = this.head.item;
			if (typeIs(item, "function")) {
				item();
			} else if (typeIs(item, "RBXScriptConnection")) {
				item.Disconnect();
			} else if (typeIs(item, "thread")) {
				task.cancel(item);
			} else if ("destroy" in item) {
				item.destroy();
			} else if ("Destroy" in item) {
				item.Destroy();
			}
			this.head = this.head.next;
		}
	}

	/**
	 * Checks whether the Bin is empty.
	 */
	public isEmpty(): boolean {
		return this.head === undefined;
	}
}

function evaluateCylindricalCollision(
	x: number,
	y: number,
	z: number,
	vx: number,
	vy: number,
	vz: number,
	ay: number,
	R: number,
	H: number,
) {
	const D = H / 2;
	const R_sq = R ** 2;
	if (-D <= y && y <= D && x ** 2 + z ** 2 <= R_sq) return 0;

	const vx_sq = vx ** 2;
	const vy_sq = vy ** 2;
	const vz_sq = vz ** 2;
	const vxz_magnitude_sq = vx_sq + vz_sq;

	// Radius intersect calculations
	const discriminant = R_sq * vxz_magnitude_sq - (vx * z - vz * x) ** 2;
	if (discriminant < 0) return;
	const b = -vx * x - vz * z;
	const t0 = (b - math.sqrt(discriminant)) / vxz_magnitude_sq;
	if (t0 > 0) {
		const height = y + vy * t0 + 0.5 * ay * t0 ** 2;
		if (-D <= height && height <= D) return t0;
	}

	// Height intersect calculations
	let t1: number | undefined;

	const min = math.max(t0, 0);
	const upper_discriminant = vy_sq + 2 * ay * (D - y);
	const lower_discriminant = vy_sq - 2 * ay * (D + y);
	if (upper_discriminant > 0) {
		const root = math.sqrt(upper_discriminant);
		const t = (-vy - root) / ay;
		if (t > min) t1 = t;
	}
	if (lower_discriminant > 0) {
		const root = math.sqrt(lower_discriminant);
		const t = (-vy + root) / ay;
		if ((t1 !== undefined && t < t1) || t > min) t1 = t;
	}
	if (t1 === undefined) return;
	const radius_sq = (x + vx * t1) ** 2 + (z + vz * t1) ** 2;
	if (radius_sq > R_sq) return;
	return t1;
}

function bindToChild(parent: Instance, name: string, callback: (child: Instance) => void) {
	const child = parent.FindFirstChild(name);
	if (child) callback(child);
	else {
		const connection = parent.ChildAdded.Connect((child) => {
			if (child.Name === name) {
				connection.Disconnect();
				callback(child);
			}
		});
	}
}

/************************************************************
 * COMPONENTS
 * Description: Classes for specific entities/objects
 * Last updated: Feb. 14, 2024
 ************************************************************/
class BaseComponent<T extends Instance> {
	protected bin = new Bin();

	constructor(readonly instance: T) {}

	/**
	 * Terminates the component and all functionality.
	 */
	public destroy(): void {
		this.bin.destroy();
	}
}

class BallComponent extends BaseComponent<BasePart> {
	public static active: BallComponent | undefined;

	private active = false;
	private target = "";
	private isHit = false;

	constructor(instance: BasePart) {
		super(instance);

		this.updateActive();
		this.updateTarget();

		const bin = this.bin;
		bin.batch(
			instance.GetAttributeChangedSignal("realBall").Connect(() => this.updateActive()),
			instance.GetAttributeChangedSignal("target").Connect(() => this.updateTarget()),
		);
		bin.batch(
			() => BallComponent.active === this && (BallComponent.active = undefined),
			instance.Destroying.Connect(() => this.destroy()),
		);
	}

	private updateTarget() {
		this.isHit = false;
		this.target = this.instance.GetAttribute("target") as string;
	}

	private updateActive() {
		this.isHit = false;
		this.active = this.instance.GetAttribute("realBall") === true;
		if (this.active) BallComponent.active = this;
		else if (BallComponent.active === this) BallComponent.active = undefined;
	}

	public debounce() {
		this.isHit = true;
	}

	public canParry() {
		return !this.isHit;
	}

	public getTarget() {
		return this.target;
	}

	public isActive() {
		return this.active;
	}
}

class RigComponent extends BaseComponent<Model> {
	public readonly root: BasePart;
	public readonly humanoid: Humanoid;

	constructor(instance: Model) {
		super(instance);

		const root = instance.WaitForChild("HumanoidRootPart") as BasePart | undefined;
		if (root === undefined) throw "Root part not found";
		const humanoid = instance.WaitForChild("Humanoid") as Humanoid | undefined;
		if (humanoid === undefined) throw "Humanoid not found";

		this.root = root;
		this.humanoid = humanoid;

		const bin = this.bin;
		bin.batch(
			humanoid.Died.Connect(() => this.destroy()),
			instance.Destroying.Connect(() => this.destroy()),
		);
	}
}

class CharacterComponent extends RigComponent {
	public static active = new Map<Model, CharacterComponent>();

	constructor(instance: Model) {
		super(instance);
	}
}

class PlayerComponent extends BaseComponent<Player> {
	public static active = new Map<Player, PlayerComponent>();

	private name = this.instance.Name;
	private character: CharacterComponent | undefined;

	constructor(instance: Player) {
		super(instance);

		const character = instance.Character;
		if (character) task.spawn(() => this.onCharacterAdded(character));

		const bin = this.bin;
		bin.batch(
			instance.CharacterAdded.Connect((character) => this.onCharacterAdded(character)),
			instance.CharacterRemoving.Connect(() => this.onCharacterRemoving()),
		);
		bin.add(() => PlayerComponent.active.delete(instance));
		PlayerComponent.active.set(instance, this);
	}

	private onCharacterAdded(character: Model) {
		this.character?.destroy();
		this.character = new CharacterComponent(character);
	}

	private onCharacterRemoving() {
		this.character?.destroy();
		this.character = undefined;
	}

	public getName() {
		return this.name;
	}

	public getCharacter() {
		return this.character;
	}
}

/************************************************************
 * CONTROLLERS
 * Description: Singletons that are used once
 * Last updated: Feb. 14, 2024
 ************************************************************/
namespace ComponentController {
	const onBallAdded = (instance: Instance) => {
		if (instance.IsA("Part")) {
			new BallComponent(instance);
		}
	};

	const onBallContainerAdded = (container: Instance) => {
		container.GetChildren().forEach((instance) => task.spawn(onBallAdded, instance));
		container.ChildAdded.Connect(onBallAdded);
	};

	const onPlayerAdded = (instance: Player) => {
		new PlayerComponent(instance);
	};

	/** @hidden */
	export function __init() {
		bindToChild(Workspace, "Balls", onBallContainerAdded);

		Players.GetPlayers().forEach((instance) => task.spawn(onPlayerAdded, instance));
		Players.PlayerAdded.Connect(onPlayerAdded);
		Players.PlayerRemoving.Connect((instance) => PlayerComponent.active.get(instance)?.destroy());
	}
}

namespace VariableController {
	export function __init() {
		gravity = Workspace.Gravity;
		Workspace.GetAttributeChangedSignal("Gravity").Connect(() => {
			gravity = Workspace.Gravity;
		});
	}
}

namespace ParryController {
	const Vector2D = new Vector3(1, 0, 1);

	const useParry = (ball: BallComponent) => {
		keypress(0x46);
		keyrelease(0x46);
		ball.debounce();
	};

	/** @hidden */
	export function __init() {
		const player = PlayerComponent.active.get(LocalPlayer)!;
		RunService.Heartbeat.Connect(() => {
			const ball = BallComponent.active;
			if (!ball) return;

			const character = player.getCharacter();
			if (!character) return;
			const name = player.getName();
			const root = character.root;
			const origin = root.Position;
			const motion = root.AssemblyLinearVelocity.mul(Vector2D);

			const instance = ball.instance;
			if (!ball.canParry()) return;
			if (ball.getTarget() !== name) return;

			const position = instance.Position.sub(origin);
			if (position.Magnitude < RADIUS) return useParry(ball);

			const velocity = instance.AssemblyLinearVelocity.sub(motion);

			const intercept = evaluateCylindricalCollision(
				position.X,
				position.Y,
				position.Z,
				velocity.X,
				velocity.Y,
				velocity.Z,
				gravity,
				RADIUS,
				HEIGHT,
			);
			if (intercept === undefined) return;
			if (intercept < COMPENSATION) return;
			return useParry(ball);
		});
	}
}

/************************************************************
 * INITIALIZATION
 * Description: Initializes and starts the runtime
 * Last updated: Feb. 14, 2024
 ************************************************************/
ComponentController.__init();
VariableController.__init();
ParryController.__init();

export = "Initialized Successfully";
