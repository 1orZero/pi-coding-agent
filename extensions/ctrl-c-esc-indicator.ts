/**
 * Ctrl-C + Esc Indicator（合併版）
 *
 * Ctrl-C：
 * - 第一次：沿用 Pi 內建 clear，並顯示提示
 * - 第二次（500ms 內）：沿用 Pi 內建 exit
 *
 * Esc（僅 operation 進行中時）：
 * - 第一次：攔截，不中止 + 在 working 訊息後顯示提示
 * - 第二次（1200ms 內）：才觸發原本中止（Operation Aborted）
 *
 * Usage: pi -e extensions/ctrl-c-esc-indicator.ts
 */

import { CustomEditor, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { matchesKey, type EditorTheme, type TUI } from "@mariozechner/pi-tui";
import { applyExtensionDefaults } from "./themeMap.ts";

const CTRL_C_STATUS_KEY = "ctrl-c-esc-indicator-ctrl-c";

const CTRL_C_WINDOW_MS = 500;
const ESC_ABORT_WINDOW_MS = 1200;

class CtrlCEscIndicatorEditor extends CustomEditor {
	private lastCtrlCAt = 0;
	private lastEscAt = 0;

	private readonly showFirstCtrlCHint: () => void;
	private readonly clearCtrlCHint: () => void;
	private readonly showFirstEscHint: () => void;
	private readonly clearEscHint: () => void;
	private readonly shouldArmEscAbort: () => boolean;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: any,
		showFirstCtrlCHint: () => void,
		clearCtrlCHint: () => void,
		showFirstEscHint: () => void,
		clearEscHint: () => void,
		shouldArmEscAbort: () => boolean,
	) {
		super(tui, theme, keybindings);
		this.showFirstCtrlCHint = showFirstCtrlCHint;
		this.clearCtrlCHint = clearCtrlCHint;
		this.showFirstEscHint = showFirstEscHint;
		this.clearEscHint = clearEscHint;
		this.shouldArmEscAbort = shouldArmEscAbort;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "ctrl+c")) {
			const now = Date.now();
			const isSecondPress = now - this.lastCtrlCAt < CTRL_C_WINDOW_MS;
			this.lastCtrlCAt = now;

			this.clearEscHint();
			if (isSecondPress) {
				this.clearCtrlCHint();
			} else {
				this.showFirstCtrlCHint();
			}

			super.handleInput(data);
			return;
		}

		if (matchesKey(data, "escape")) {
			// 保留 autocomplete 的 Esc 取消行為
			if (this.isShowingAutocomplete()) {
				this.clearEscHint();
				super.handleInput(data);
				return;
			}

			// 閒置時保持 Pi 預設 Esc 行為
			if (!this.shouldArmEscAbort()) {
				this.clearEscHint();
				super.handleInput(data);
				return;
			}

			const now = Date.now();
			const isSecondPress = now - this.lastEscAt < ESC_ABORT_WINDOW_MS;
			this.lastEscAt = now;

			this.clearCtrlCHint();
			if (isSecondPress) {
				this.clearEscHint();
				super.handleInput(data); // 第二下先真正中止
			} else {
				this.showFirstEscHint();
				return; // 第一下攔截
			}
			return;
		}

		this.clearCtrlCHint();
		this.clearEscHint();
		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	let ctrlCTimer: NodeJS.Timeout | undefined;
	let escTimer: NodeJS.Timeout | undefined;
	let escHintActive = false;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		applyExtensionDefaults(import.meta.url, ctx);

		const clearCtrlCHint = () => {
			if (ctrlCTimer) {
				clearTimeout(ctrlCTimer);
				ctrlCTimer = undefined;
			}
			ctx.ui.setStatus(CTRL_C_STATUS_KEY, undefined);
		};

		const clearEscHint = () => {
			if (escTimer) {
				clearTimeout(escTimer);
				escTimer = undefined;
			}
			if (!escHintActive) return;
			escHintActive = false;
			ctx.ui.setWorkingMessage(); // restore default working message
		};

		const showFirstCtrlCHint = () => {
			clearCtrlCHint();
			const hint =
				ctx.ui.theme.fg("warning", "Cleared") +
				ctx.ui.theme.fg("dim", " · Ctrl-C again exits");
			ctx.ui.setStatus(CTRL_C_STATUS_KEY, hint);

			ctrlCTimer = setTimeout(() => {
				ctx.ui.setStatus(CTRL_C_STATUS_KEY, undefined);
				ctrlCTimer = undefined;
			}, CTRL_C_WINDOW_MS);
		};

		const showFirstEscHint = () => {
			clearEscHint();
			escHintActive = true;
			ctx.ui.setWorkingMessage("Working... · Esc again aborts");

			escTimer = setTimeout(() => {
				escTimer = undefined;
				clearEscHint();
			}, ESC_ABORT_WINDOW_MS);
		};

		const shouldArmEscAbort = () => !ctx.isIdle();

		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new CtrlCEscIndicatorEditor(
				tui,
				theme,
				keybindings,
				showFirstCtrlCHint,
				clearCtrlCHint,
				showFirstEscHint,
				clearEscHint,
				shouldArmEscAbort,
			)
		);
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (escTimer) {
			clearTimeout(escTimer);
			escTimer = undefined;
		}
		if (escHintActive) {
			escHintActive = false;
			ctx.ui.setWorkingMessage();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		ctx.ui.setStatus(CTRL_C_STATUS_KEY, undefined);

		if (ctrlCTimer) {
			clearTimeout(ctrlCTimer);
			ctrlCTimer = undefined;
		}
		if (escTimer) {
			clearTimeout(escTimer);
			escTimer = undefined;
		}
		if (escHintActive) {
			escHintActive = false;
			ctx.ui.setWorkingMessage();
		}
	});
}
