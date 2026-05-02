<script lang="ts">
	import { untrack } from 'svelte';
	import { mode } from 'mode-watcher';
	import { TerminalFrameSchema, type TerminalFrame, type WorkspaceState } from '@crucible/types';
	import type { Terminal as XTermTerminal, IDisposable } from '@xterm/xterm';
	import type { FitAddon as XTermFitAddon } from '@xterm/addon-fit';
	import '@xterm/xterm/css/xterm.css';
	import EmptyState from '$lib/components/empty-state.svelte';
	import { Button } from '$lib/components/ui/button';
	import PlugIcon from 'phosphor-svelte/lib/PlugIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import XCircleIcon from 'phosphor-svelte/lib/XCircleIcon';

	// xterm.js renders into a canvas and won't natively read CSS variables,
	// so we resolve the theme tokens (background / foreground) at runtime
	// from the document root. Re-resolved when the user toggles light/dark.
	function resolveTerminalTheme(): { background: string; foreground: string } {
		if (typeof window === 'undefined') {
			return { background: 'transparent', foreground: 'inherit' };
		}
		const styles = getComputedStyle(document.documentElement);
		const background = styles.getPropertyValue('--background').trim() || 'transparent';
		const foreground = styles.getPropertyValue('--foreground').trim() || 'inherit';
		return { background, foreground };
	}

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();

	let host: HTMLDivElement | null = $state(null);
	let status: 'connecting' | 'open' | 'closed' | 'error' = $state('connecting');
	let errorReason: string | null = $state(null);
	// nonce forces the connect effect to re-run on a manual reconnect
	let reconnectNonce = $state(0);
	// Live xterm instance — exposed so the mode-watcher effect can repaint
	// the canvas theme when the user toggles between light and dark.
	let liveTerm: XTermTerminal | null = $state(null);

	const workspaceId = $derived(workspace?.id ?? null);

	// Repaint the xterm canvas whenever the theme mode flips. The first run
	// races the connect effect (terminal not yet created), in which case
	// `liveTerm` is null and we no-op — the connect effect picks up the
	// current theme at construction time.
	//
	// Two subtleties:
	//   1. ModeWatcher flips `.dark` on <html> on the same tick that
	//      `mode.current` updates, but the layout / `getComputedStyle`
	//      values for our CSS vars are only guaranteed fresh after a
	//      style flush. We defer the read with rAF so the resolved
	//      theme matches what the rest of the UI just rendered.
	//   2. Reassigning `term.options.theme` updates the renderer's color
	//      tables but doesn't always invalidate the existing canvas
	//      buffer (xterm repaints on next write, not retroactively),
	//      so on a no-output toggle the previous frame's pixels stick.
	//      `refresh(0, rows - 1)` forces a full repaint at the new
	//      colors. Touching only the renderer — never the WebSocket
	//      or the PTY — so terminal connectivity is unaffected.
	$effect(() => {
		void mode.current;
		const term = liveTerm;
		if (!term) return;
		const handle = requestAnimationFrame(() => {
			if (term !== liveTerm) return;
			term.options.theme = resolveTerminalTheme();
			term.refresh(0, term.rows - 1);
		});
		return () => cancelAnimationFrame(handle);
	});

	// xterm.js ships a CJS+ESM hybrid that Vite sometimes serves as CJS, in
	// which case `import { Terminal } from '@xterm/xterm'` fails with "named
	// export not found". Dynamic import + safe destructure handles either
	// shape (default-export CJS, namespace ESM) without forcing a Vite config
	// change.
	type XTermNs = typeof import('@xterm/xterm');
	type FitNs = typeof import('@xterm/addon-fit');

	function pickTerminal(mod: unknown): typeof XTermTerminal | undefined {
		const m = mod as Partial<XTermNs> & { default?: Partial<XTermNs> };
		return m.Terminal ?? m.default?.Terminal;
	}

	function pickFitAddon(mod: unknown): typeof XTermFitAddon | undefined {
		const m = mod as Partial<FitNs> & { default?: Partial<FitNs> };
		return m.FitAddon ?? m.default?.FitAddon;
	}

	$effect(() => {
		if (!workspaceId || !host) return;
		// re-run on reconnect clicks
		void reconnectNonce;

		if (typeof window === 'undefined') return;

		untrack(() => {
			status = 'connecting';
			errorReason = null;
		});

		let cancelled = false;
		let term: XTermTerminal | null = null;
		let onDataDisp: IDisposable | null = null;
		let onResizeDisp: IDisposable | null = null;
		let ro: ResizeObserver | null = null;
		let ws: WebSocket | null = null;
		// Frames may arrive over WS before xterm finishes loading (the bash
		// prompt fires within milliseconds of the PTY spawning). Buffer until
		// the terminal is ready, then flush.
		const pending: TerminalFrame[] = [];

		const send = (frame: TerminalFrame) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify(frame));
			}
		};

		const applyFrame = (frame: TerminalFrame) => {
			if (!term) return;
			if (frame.kind === 'data') {
				term.write(frame.data);
			} else if (frame.kind === 'exit') {
				term.write(`\r\n\x1b[2m[process exited with code ${frame.exitCode}]\x1b[0m\r\n`);
			}
		};

		(async () => {
			let xtermMod: unknown;
			let fitMod: unknown;
			try {
				[xtermMod, fitMod] = await Promise.all([
					import('@xterm/xterm'),
					import('@xterm/addon-fit')
				]);
			} catch (err) {
				if (cancelled) return;
				console.error('[term] failed to load xterm.js', err);
				status = 'error';
				errorReason = 'Failed to load terminal library';
				return;
			}

			if (cancelled || !host) return;

			const Terminal = pickTerminal(xtermMod);
			const FitAddon = pickFitAddon(fitMod);
			if (!Terminal || !FitAddon) {
				console.error('[term] xterm module missing Terminal/FitAddon export', {
					xtermMod,
					fitMod
				});
				status = 'error';
				errorReason = 'Terminal library failed to initialize';
				return;
			}

			term = new Terminal({
				cursorBlink: true,
				fontFamily:
					'"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
				fontSize: 13,
				scrollback: 5000,
				allowProposedApi: true,
				theme: resolveTerminalTheme()
			});
			liveTerm = term;
			const fitAddon = new FitAddon();
			term.loadAddon(fitAddon);
			term.open(host);

			const safeFit = () => {
				try {
					fitAddon.fit();
				} catch {
					// container may be 0x0 mid-layout
				}
			};
			safeFit();
			ro = new ResizeObserver(safeFit);
			ro.observe(host);

			onDataDisp = term.onData((data) => send({ kind: 'data', data }));
			onResizeDisp = term.onResize(({ cols, rows }) => send({ kind: 'resize', cols, rows }));

			// Open the WebSocket only once xterm is ready, so we don't have to
			// race buffered frames against an uninitialized terminal.
			const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			const url = `${proto}//${window.location.host}/ws/terminal?workspaceId=${encodeURIComponent(workspaceId)}`;
			ws = new WebSocket(url);

			ws.onopen = () => {
				if (cancelled) return;
				status = 'open';
				// xterm only fires `onResize` on changes; push the current size
				// once on open so the PTY matches the rendered grid from frame zero.
				send({ kind: 'resize', cols: term!.cols, rows: term!.rows });
				term?.focus();
				// Drain any frames buffered between WS open and xterm ready
				// (rare but possible if onmessage fires before this onopen).
				for (const frame of pending) applyFrame(frame);
				pending.length = 0;
			};

			ws.onmessage = (event) => {
				if (cancelled) return;
				if (typeof event.data !== 'string') return;
				let parsed: unknown;
				try {
					parsed = JSON.parse(event.data);
				} catch {
					return;
				}
				const result = TerminalFrameSchema.safeParse(parsed);
				if (!result.success) return;
				const frame = result.data;
				if (term) applyFrame(frame);
				else pending.push(frame);
			};

			ws.onerror = () => {
				if (cancelled) return;
				status = 'error';
			};

			ws.onclose = (event) => {
				if (cancelled) return;
				if (event.code === 1000) {
					status = 'closed';
					return;
				}
				status = 'error';
				// Backend close codes (4404 / 4503 / 4500) carry a useful reason.
				errorReason = event.reason || `Connection closed (code ${event.code})`;
			};
		})();

		return () => {
			cancelled = true;
			ro?.disconnect();
			ro = null;
			onDataDisp?.dispose();
			onResizeDisp?.dispose();
			onDataDisp = null;
			onResizeDisp = null;
			term?.dispose();
			term = null;
			liveTerm = null;
			if (ws && ws.readyState !== WebSocket.CLOSED) {
				try {
					ws.close(1000, 'component teardown');
				} catch {
					// ignore — socket may already be closing
				}
			}
			ws = null;
		};
	});

	function reconnect() {
		reconnectNonce += 1;
	}
</script>

<section class="flex h-full min-h-0 flex-col bg-background">
	{#if !workspace}
		<EmptyState
			title="No workspace open"
			description="Create or open a workspace to attach a terminal session."
		/>
	{:else if status === 'error'}
		<EmptyState
			variant="degraded"
			title="Terminal disconnected"
			description={errorReason ?? 'The PTY WebSocket closed unexpectedly or failed to start.'}
		>
			{#snippet actions()}
				<Button size="sm" variant="outline" onclick={reconnect}>Reconnect</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div
			class="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted/20 px-2 py-1 font-mono text-xs"
		>
			{#if status === 'connecting'}
				<CircleNotchIcon class="size-3 animate-spin text-muted-foreground" weight="bold" />
				<span class="text-muted-foreground">connecting…</span>
			{:else if status === 'closed'}
				<XCircleIcon class="size-3 text-muted-foreground" weight="fill" />
				<span class="text-muted-foreground">session ended</span>
			{:else}
				<span
					class="size-1.5 rounded-full bg-live shadow-[0_0_6px_var(--live)]"
					aria-hidden="true"
				></span>
				<PlugIcon class="size-3 text-live" weight="fill" />
				<span class="text-live">connected</span>
			{/if}
		</div>
		<div bind:this={host} class="size-full overflow-hidden bg-background p-2"></div>
	{/if}
</section>
