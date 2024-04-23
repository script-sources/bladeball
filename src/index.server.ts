import { Players, RunService, Workspace } from "@rbxts/services";
import { Destructible, Node } from "types";

if (_G["bladeball"]) throw "This program is already running!";
_G["bladeball"] = true;

/************************************************************
 * CONFIGURATIONS
 * Description: User-defined settings and configurations
 * Last updated: Feb. 14, 2024
 ************************************************************/
const RADIUS = 17.5;
const COMPENSATION = 200 / 1000; // 140ms (in seconds)

/************************************************************
 * VARIABLES
 * Description: Variables referenced globally in the script
 * Last updated: Feb. 14, 2024
 ************************************************************/
const LocalPlayer = Players.LocalPlayer;

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

function evaluateIntercept(
	x: number,
	y: number,
	z: number,
	vx: number,
	vy: number,
	vz: number,
	R: number,
): number | undefined {
	const a = vx ** 2 + vy ** 2 + vz ** 2;
	const b = 2 * (vx * x + vy * y + vz * z);
	const c = x ** 2 + y ** 2 + z ** 2 - R ** 2;

	const discriminant = b ** 2 - 4 * a * c;
	if (discriminant < 0) return;

	const sqrtDiscriminant = math.sqrt(discriminant);
	const denominator = 2 * a;

	const t0 = (-b - sqrtDiscriminant) / denominator;
	if (t0 > 0) return t0;

	const t1 = (-b + sqrtDiscriminant) / denominator;
	if (t1 > 0) return t1;

	return undefined;
}

function calculateRadius(x: number, z: number, vx: number, vz: number, t: number) {
	const dx = x + vx * t;
	const dz = z + vz * t;
	return math.sqrt(dx ** 2 + dz ** 2);
}

function calculateHeight(y: number, vy: number, ay: number, t: number) {
	const dy = y + vy * t + 0.5 * ay * t ** 2;
	return dy;
}

function evaluate(
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
	const vx_sq = vx ** 2;
	const vz_sq = vz ** 2;
	const R_sq = R ** 2;
	const discriminant = R_sq * (vx_sq + vz_sq) - (vx * z - vz * x) ** 2;
	if (discriminant > 0) {
		const a = vx_sq + vz_sq;
		const b = -vx * x - vz * z;
		const c = math.sqrt(discriminant);

		const t0 = (b - c) / a;
		const t1 = (b + c) / a;

		if (t0 > 0) {
			const dy = y + vy * t0 + 0.5 * ay * t0 ** 2;
			if (dy < H) return t0;
		} else if (t1 > 0) {
			const dy = y + vy * t1 + 0.5 * ay * t1 ** 2;
			if (dy < H) return t1;
		}
	}

	const postive_discriminant = ay * H + 0.5 * vy ** 2;
	if (postive_discriminant > 0) {
		const root = math.sqrt(postive_discriminant);
		const t0 = (-vy + root) / ay;
		const t1 = (-vy - root) / ay;
		if (t0 > 0) {
			const r = calculateRadius(x, z, vx, vz, t0);
			if (r < R) return t0;
		}
	}

	const negative_discriminant = -ay * H + 0.5 * vy ** 2;
	if (negative_discriminant > 0) {
		const root = math.sqrt(negative_discriminant);
		const t0 = (-vy + root) / ay;
		const t1 = (-vy - root) / ay;
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
	public static active = new Map<BasePart, BallComponent>();

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
			() => BallComponent.active.delete(instance),
			instance.Destroying.Connect(() => this.destroy()),
		);
		BallComponent.active.set(instance, this);
	}

	private updateTarget() {
		this.isHit = false;
		this.target = this.instance.GetAttribute("target") as string;
	}

	private updateActive() {
		this.isHit = false;
		this.active = this.instance.GetAttribute("realBall") === true;
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
	const BallFolder = Workspace.WaitForChild("Balls", 10) as Folder;

	const onBallAdded = (instance: Instance) => {
		if (instance.IsA("Part")) {
			new BallComponent(instance);
		}
	};

	const onPlayerAdded = (instance: Player) => {
		new PlayerComponent(instance);
	};

	/** @hidden */
	export function __init() {
		BallFolder.GetChildren().forEach((instance) => task.spawn(onBallAdded, instance));
		BallFolder.ChildAdded.Connect(onBallAdded);

		Players.GetPlayers().forEach((instance) => task.spawn(onPlayerAdded, instance));
		Players.PlayerAdded.Connect(onPlayerAdded);
		Players.PlayerRemoving.Connect((instance) => PlayerComponent.active.get(instance)?.destroy());
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
			const character = player.getCharacter();
			if (!character) return;
			const name = player.getName();
			const root = character.root;
			const origin = root.Position;
			const motion = root.AssemblyLinearVelocity.mul(Vector2D);
			BallComponent.active.forEach((ball, instance) => {
				if (!ball.canParry()) return;
				if (ball.getTarget() !== name) return;

				const position = instance.Position.sub(origin);
				if (position.Magnitude < RADIUS) return useParry(ball);

				const velocity = instance.AssemblyLinearVelocity.sub(motion);

				const intercept = evaluateIntercept(
					position.X,
					position.Y,
					position.Z,
					velocity.X,
					velocity.Y,
					velocity.Z,
					RADIUS,
				);
				if (intercept === undefined) return;
				if (intercept > COMPENSATION) return;
				return useParry(ball);
			});
		});
	}
}

/************************************************************
 * INITIALIZATION
 * Description: Initializes and starts the runtime
 * Last updated: Feb. 14, 2024
 ************************************************************/
ComponentController.__init();
ParryController.__init();

export = "Initialized Successfully";
