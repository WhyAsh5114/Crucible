<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Component } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import type { WorkspaceFile, WorkspaceState } from '@crucible/types';
	import { workspaceClient } from '$lib/api/workspace';
	import EmptyState from '$lib/components/empty-state.svelte';
	import FileTree from '$lib/components/file-tree.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import FileTsIcon from 'phosphor-svelte/lib/FileTsIcon';
	import FileJsIcon from 'phosphor-svelte/lib/FileJsIcon';
	import FileCssIcon from 'phosphor-svelte/lib/FileCssIcon';
	import FileHtmlIcon from 'phosphor-svelte/lib/FileHtmlIcon';
	import FileMdIcon from 'phosphor-svelte/lib/FileMdIcon';
	import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import BracketsCurlyIcon from 'phosphor-svelte/lib/BracketsCurlyIcon';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';

	// Maps WorkspaceFile['lang'] → phosphor icon component. Solidity uses the
	// Cube icon to lean into the smart-contract / EVM bytecode metaphor; the
	// rest pick the closest dedicated phosphor file icon, falling back to
	// FileCode / FileText for unspecific languages.
	const LANG_ICONS: Record<WorkspaceFile['lang'], Component> = {
		typescript: FileTsIcon,
		javascript: FileJsIcon,
		json: BracketsCurlyIcon,
		css: FileCssIcon,
		html: FileHtmlIcon,
		markdown: FileMdIcon,
		solidity: CubeIcon,
		svelte: FileCodeIcon,
		plaintext: FileTextIcon
	};

	interface Props {
		workspace: WorkspaceState | null;
	}

	let { workspace }: Props = $props();
	const stream = getAgentStream();

	let host: HTMLDivElement | null = $state(null);
	let editor = $state<{
		destroy(): void;
		setDoc(content: string, lang: WorkspaceFile['lang']): void;
		getDoc(): string;
	} | null>(null);

	// Save state — surfaced in the editor header.
	type SaveState = 'clean' | 'dirty' | 'saving' | 'error';
	let saveState = $state<SaveState>('clean');
	let saveError = $state<string | null>(null);

	// Files with local unsaved edits. Used to suppress incoming `file_write`
	// SSE updates so the agent can't clobber the user's in-flight edit while
	// they're typing. (User saves don't echo back through the agent stream —
	// the PUT endpoint deliberately doesn't publish.)
	const dirtyPaths = new SvelteSet<string>();

	// Last-known-saved content per path. The PUT /file endpoint deliberately
	// doesn't publish a file_write event back through the agent stream, so
	// `workspace.files` (the initial snapshot prop) never sees our save. If
	// the user switches files and switches back, the file tree's `activeFile`
	// would otherwise resolve to the snapshot's stale bytes and the editor
	// effect would `setDoc` them, wiping the user's saved changes from view.
	// Filling this map on save success and overlaying it in the `files`
	// derivation makes the user's saved content the visible source of truth
	// across navigations.
	const localContent = new SvelteMap<string, string>();

	// Wall-clock millisecond of the last user save per path. Used so an
	// agent edit that genuinely lands AFTER the user's save (rare but real
	// on long-running agent turns) can still take precedence over the
	// user's saved content; otherwise the user's local would shadow the
	// agent's newer write forever. Comparing against `file_write.emittedAt`
	// is good enough — both are produced by the same backend clock.
	const userSavedAt = new SvelteMap<string, number>();

	// Shared set of expanded directory paths in the file tree. Sharing state
	// here lets the breadcrumb clicks expand the matching folder.
	const expandedPaths = new SvelteSet<string>();

	// Merge the workspace's initial snapshot with live `file_write` events from
	// the agent stream so the editor + file tree update the moment the agent
	// writes a file — without a manual refresh. The snapshot from
	// `getWorkspace()` is only fresh on mount; everything after relies on SSE.
	// `file_write.content` is omitted for very large files (per the schema);
	// in that case we keep the snapshot version and bump `modifiedAt` so the
	// file tree at least reflects that something changed.
	//
	// If the user has unsaved local edits for a path, we DO NOT overwrite the
	// content — we keep `localContent[path]` and only refresh the file's
	// metadata. The agent's update is implicitly discarded; surfacing a merge
	// UI is future work. (Self-saves echo back too — those are filtered by
	// content equality so we don't clobber an in-progress edit with our own
	// just-saved bytes.)
	// Generated / build directories that the editor should ignore. Anything
	// containing one of these segments is a Hardhat / Vite / package-manager
	// artifact — not user source. Hiding them prevents:
	//   - Users editing `.d.ts` typings that get clobbered on next compile.
	//   - Save attempts hitting EACCES because the runtime container writes
	//     these dirs as root and the host backend can't open files for atomic
	//     replace inside them.
	const IGNORED_DIR_SEGMENTS = new Set(['artifacts', 'cache', 'node_modules', '.crucible']);
	function isGeneratedPath(path: string): boolean {
		return path.split('/').some((seg) => IGNORED_DIR_SEGMENTS.has(seg));
	}

	const files = $derived.by<WorkspaceFile[]>(() => {
		const map = new SvelteMap<string, WorkspaceFile>();
		for (const f of workspace?.files ?? []) {
			if (isGeneratedPath(f.path)) continue;
			// Overlay the user's last-saved content on top of the snapshot.
			// Snapshot is fresh only on mount; saves don't echo back, so without
			// this overlay the editor would revert to snapshot bytes whenever
			// the user navigates away and returns.
			const local = localContent.get(f.path);
			map.set(f.path, local !== undefined ? { ...f, content: local } : f);
		}
		for (const ev of stream.events) {
			if (ev.type !== 'file_write') continue;
			if (isGeneratedPath(ev.path)) continue;
			// If the user saved this path more recently than the agent's emit,
			// the user's save wins. (Without this guard, an out-of-order replay
			// of a stale agent file_write could overwrite a fresh user save.)
			const savedAt = userSavedAt.get(ev.path);
			if (savedAt !== undefined && savedAt >= ev.emittedAt) continue;
			const existing = map.get(ev.path);
			const keepLocal = dirtyPaths.has(ev.path);
			map.set(ev.path, {
				path: ev.path,
				content: keepLocal ? (existing?.content ?? '') : (ev.content ?? existing?.content ?? ''),
				lang: ev.lang,
				hash: ev.hash,
				modifiedAt: ev.emittedAt
			});
		}
		return [...map.values()];
	});
	let activePath = $state<string | null>(null);
	const activeFile = $derived<WorkspaceFile | null>(
		files.find((f) => f.path === activePath) ?? files[0] ?? null
	);

	// Only swap the editor's document when the user actually opens a different
	// file — never on content drift. Once a path is loaded the editor owns
	// that buffer until the user switches files; this keeps cursor/selection/
	// undo history intact and prevents "every keystroke reverts" bugs.
	//
	// The bugs this avoids:
	//   1. User types → updateListener → scheduleSave → dirtyPaths.add(path)
	//      → files derive re-runs (it reads dirtyPaths.has) → new activeFile
	//      reference → if we compared content here we'd see the editor doc
	//      doesn't match the stale server snapshot and call setDoc, wiping
	//      whatever the user just typed and yanking the cursor to line 0.
	//   2. After save, dirtyPaths.delete fires the same chain and would
	//      revert again — because PUT /file deliberately doesn't echo
	//      file_write, so activeFile.content stays at the original snapshot.
	//
	// Tracked via a non-reactive local — not $state — so assigning to it
	// inside the effect does not retrigger the effect.
	let lastLoadedPath: string | null = null;
	$effect(() => {
		if (!editor || !activeFile) return;
		const path = activeFile.path;
		if (path === lastLoadedPath) return;
		editor.setDoc(activeFile.content, activeFile.lang);
		lastLoadedPath = path;
		saveState = dirtyPaths.has(path) ? 'dirty' : 'clean';
		saveError = null;
	});

	// ── Save plumbing ────────────────────────────────────────────────────────
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	const SAVE_DEBOUNCE_MS = 500;

	async function saveActive(): Promise<void> {
		if (!workspace || !activeFile) return;
		const path = activeFile.path;
		const content = editor?.getDoc() ?? '';
		saveState = 'saving';
		saveError = null;
		try {
			await workspaceClient.writeFile(workspace.id, { path, content });
			// Persist the saved bytes locally so a switch-away-and-back to
			// this path resolves to the user's content rather than the stale
			// workspace.files snapshot. Stamp `userSavedAt` so the files
			// derivation knows our save is fresher than any agent file_write
			// that arrives with an older emittedAt.
			localContent.set(path, content);
			userSavedAt.set(path, Date.now());
			// Only clear dirty if the editor's content still matches what we
			// just sent — otherwise the user typed more during the await and
			// the next debounce / keystroke will fire another save.
			if (editor?.getDoc() === content) {
				dirtyPaths.delete(path);
				saveState = 'clean';
			}
		} catch (err) {
			saveError = err instanceof Error ? err.message : String(err);
			saveState = 'error';
			toast.error('Failed to save file', { description: saveError });
		}
	}

	function scheduleSave(): void {
		if (!activeFile) return;
		dirtyPaths.add(activeFile.path);
		saveState = 'dirty';
		if (saveTimer !== null) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			void saveActive();
		}, SAVE_DEBOUNCE_MS);
	}

	function flushSaveImmediately(): void {
		if (saveTimer !== null) {
			clearTimeout(saveTimer);
			saveTimer = null;
			void saveActive();
		}
	}

	// ── Breadcrumb interactions ──────────────────────────────────────────────
	const segments = $derived<string[]>(
		activeFile ? activeFile.path.split('/').filter((s) => s.length > 0) : []
	);
	const dirSegments = $derived<string[]>(segments.slice(0, -1));
	const fileName = $derived<string>(segments.at(-1) ?? '');

	function dirPathAt(index: number): string {
		return dirSegments.slice(0, index + 1).join('/');
	}

	/**
	 * Files (excluding subdirectories) that live directly under `dirPath`.
	 * Used by the breadcrumb dropdowns so users can switch between siblings
	 * without leaving the header. `dirPath === ''` means the workspace root.
	 */
	function filesAt(dirPath: string): WorkspaceFile[] {
		if (dirPath === '') {
			return files.filter((f) => !f.path.includes('/'));
		}
		const prefix = `${dirPath}/`;
		return files.filter((f) => {
			if (!f.path.startsWith(prefix)) return false;
			return !f.path.slice(prefix.length).includes('/');
		});
	}

	function leafName(filePath: string): string {
		const idx = filePath.lastIndexOf('/');
		return idx === -1 ? filePath : filePath.slice(idx + 1);
	}

	// ── Persistence ──────────────────────────────────────────────────────────
	// Open file + expanded folders are persisted per workspace so a reload
	// drops the user back where they left off. localStorage is plenty here —
	// the data is small, per-device, and cheap to corrupt-recover from.
	const STORAGE_KEY_PREFIX = 'crucible:editor:';
	let hydrated = $state(false);

	onMount(() => {
		if (!workspace) {
			hydrated = true;
			return;
		}
		try {
			const raw = localStorage.getItem(STORAGE_KEY_PREFIX + workspace.id);
			if (raw) {
				const parsed = JSON.parse(raw) as {
					activePath?: string | null;
					expandedPaths?: string[];
				};
				if (Array.isArray(parsed.expandedPaths)) {
					for (const p of parsed.expandedPaths) expandedPaths.add(p);
				}
				if (typeof parsed.activePath === 'string') {
					activePath = parsed.activePath;
				}
			}
		} catch {
			// Corrupt or unavailable storage — fall back to defaults.
		}
		hydrated = true;
	});

	$effect(() => {
		if (!hydrated || !workspace) return;
		const ap = activePath;
		const ep = [...expandedPaths];
		try {
			localStorage.setItem(
				STORAGE_KEY_PREFIX + workspace.id,
				JSON.stringify({ activePath: ap, expandedPaths: ep })
			);
		} catch {
			// Quota or disabled — silently skip.
		}
	});

	onMount(async () => {
		if (!host) return;

		const [
			{ EditorState, Compartment },
			{ EditorView, lineNumbers, highlightActiveLine, keymap },
			{ defaultKeymap, history, historyKeymap },
			{ HighlightStyle, syntaxHighlighting, indentOnInput, bracketMatching, foldGutter },
			{ tags: t },
			{ javascript },
			{ json },
			{ css },
			{ html },
			{ markdown },
			solidity,
			svelteLang
		] = await Promise.all([
			import('@codemirror/state'),
			import('@codemirror/view'),
			import('@codemirror/commands'),
			import('@codemirror/language'),
			import('@lezer/highlight'),
			import('@codemirror/lang-javascript'),
			import('@codemirror/lang-json'),
			import('@codemirror/lang-css'),
			import('@codemirror/lang-html'),
			import('@codemirror/lang-markdown'),
			import('@replit/codemirror-lang-solidity'),
			import('@replit/codemirror-lang-svelte')
		]);

		const langCompartment = new Compartment();

		const cssVarTheme = EditorView.theme(
			{
				'&': {
					color: 'var(--foreground)',
					backgroundColor: 'transparent',
					height: '100%',
					fontSize: '13px'
				},
				'.cm-scroller': {
					fontFamily: '"JetBrains Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace',
					lineHeight: '1.55'
				},
				'.cm-content': { caretColor: 'var(--foreground)' },
				'.cm-cursor': { borderLeftColor: 'var(--foreground)' },
				'.cm-gutters': {
					backgroundColor: 'transparent',
					color: 'var(--muted-foreground)',
					borderRight: '1px solid var(--border)'
				},
				'.cm-activeLine': { backgroundColor: 'transparent' },
				'.cm-activeLineGutter': {
					backgroundColor: 'transparent',
					color: 'var(--foreground)'
				},
				'&.cm-focused .cm-activeLine': {
					backgroundColor: 'color-mix(in oklch, var(--muted) 50%, transparent)'
				},
				'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
					backgroundColor: 'color-mix(in oklch, var(--primary) 25%, transparent)'
				},
				'.cm-foldPlaceholder': {
					backgroundColor: 'var(--muted)',
					color: 'var(--muted-foreground)',
					border: 'none'
				},
				'.cm-line': { padding: '0 12px' }
			},
			{ dark: false }
		);

		const cssVarHighlight = HighlightStyle.define([
			{
				tag: [t.keyword, t.controlKeyword, t.modifier, t.definitionKeyword],
				color: 'var(--primary)'
			},
			{ tag: [t.string, t.regexp, t.character, t.special(t.string)], color: 'var(--live)' },
			{ tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syntax-number)' },
			{
				tag: [t.comment, t.lineComment, t.blockComment, t.docComment],
				color: 'var(--muted-foreground)',
				fontStyle: 'italic'
			},
			{
				tag: [t.function(t.variableName), t.function(t.propertyName)],
				color: 'var(--syntax-function)'
			},
			{ tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-type)' },
			{ tag: [t.tagName, t.heading], color: 'var(--primary)' },
			{ tag: [t.attributeName, t.propertyName], color: 'var(--syntax-type)' },
			{ tag: [t.variableName], color: 'var(--foreground)' },
			{
				tag: [
					t.operator,
					t.derefOperator,
					t.compareOperator,
					t.logicOperator,
					t.arithmeticOperator,
					t.bitwiseOperator,
					t.updateOperator,
					t.definitionOperator
				],
				color: 'var(--syntax-punctuation)'
			},
			{
				tag: [t.punctuation, t.brace, t.bracket, t.paren, t.separator, t.angleBracket],
				color: 'var(--syntax-punctuation)'
			},
			{ tag: [t.link, t.url], color: 'var(--live)', textDecoration: 'underline' },
			{ tag: [t.emphasis], fontStyle: 'italic' },
			{ tag: [t.strong], fontWeight: '600' },
			{ tag: [t.invalid], color: 'var(--destructive)' }
		]);

		const langForFile = (lang: WorkspaceFile['lang']) => {
			switch (lang) {
				case 'javascript':
					return javascript();
				case 'typescript':
					return javascript({ typescript: true });
				case 'json':
					return json();
				case 'css':
					return css();
				case 'html':
					return html();
				case 'markdown':
					return markdown();
				case 'solidity':
					return solidity.solidity;
				case 'svelte':
					return svelteLang.svelte();
				case 'plaintext':
				default:
					return [];
			}
		};

		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: activeFile?.content ?? '',
				extensions: [
					lineNumbers(),
					foldGutter(),
					highlightActiveLine(),
					indentOnInput(),
					bracketMatching(),
					history(),
					syntaxHighlighting(cssVarHighlight),
					keymap.of([
						...defaultKeymap,
						...historyKeymap,
						{
							key: 'Mod-s',
							run: () => {
								flushSaveImmediately();
								return true;
							}
						}
					]),
					cssVarTheme,
					EditorView.updateListener.of((update) => {
						// Ignore programmatic doc swaps (when we switch files); only
						// react to user-driven edits. `userEvent` is set on input/paste.
						if (!update.docChanged) return;
						const isUserEdit = update.transactions.some(
							(tr) =>
								tr.isUserEvent('input') ||
								tr.isUserEvent('delete') ||
								tr.isUserEvent('paste') ||
								tr.isUserEvent('cut')
						);
						if (!isUserEdit) return;
						scheduleSave();
					}),
					langCompartment.of(langForFile(activeFile?.lang ?? 'plaintext'))
				]
			})
		});

		editor = {
			destroy: () => view.destroy(),
			setDoc: (content, lang) => {
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: content },
					effects: langCompartment.reconfigure(langForFile(lang))
				});
			},
			getDoc: () => view.state.doc.toString()
		};
	});

	onDestroy(() => {
		if (saveTimer !== null) clearTimeout(saveTimer);
		editor?.destroy();
	});
</script>

<section class="flex h-full min-h-0">
	{#if files.length === 0}
		<EmptyState
			title="No files yet"
			description="The agent hasn't written any source files into this workspace."
		/>
	{:else}
		<Resizable.PaneGroup direction="horizontal" class="size-full">
			<Resizable.Pane defaultSize={22} minSize={14} maxSize={40}>
				<aside class="h-full min-h-0 overflow-y-auto border-r border-border bg-muted/10">
					<header
						class="sticky top-0 z-10 border-b border-border bg-background/80 px-3 py-2 font-mono text-[10px] tracking-wide text-muted-foreground uppercase backdrop-blur"
					>
						files
					</header>
					<FileTree
						{files}
						activePath={activeFile?.path ?? null}
						onSelect={(path) => (activePath = path)}
						{expandedPaths}
					/>
				</aside>
			</Resizable.Pane>
			<Resizable.Handle />
			<Resizable.Pane defaultSize={78}>
				<div class="flex h-full min-h-0 flex-col">
					<header
						class="flex shrink-0 items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5"
					>
						{#if activeFile}
							{@const LangIcon = LANG_ICONS[activeFile.lang]}
							<LangIcon class="size-4 shrink-0 text-primary" weight="fill" />
							<Breadcrumb.Root class="min-w-0">
								<Breadcrumb.List class="gap-1 text-xs sm:gap-1">
									{#each dirSegments as seg, i (i)}
										{@const dirSiblings = filesAt(dirPathAt(i))}
										<Breadcrumb.Item>
											<DropdownMenu.Root>
												<DropdownMenu.Trigger
													class="cursor-pointer font-mono text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none"
												>
													{seg}
												</DropdownMenu.Trigger>
												{#if dirSiblings.length > 0}
													<DropdownMenu.Content align="start" class="font-mono text-xs">
														{#each dirSiblings as f (f.path)}
															<DropdownMenu.Item
																onSelect={() => (activePath = f.path)}
																class={f.path === activeFile.path
																	? 'bg-primary/10 text-primary'
																	: ''}
															>
																{leafName(f.path)}
															</DropdownMenu.Item>
														{/each}
													</DropdownMenu.Content>
												{/if}
											</DropdownMenu.Root>
										</Breadcrumb.Item>
										<Breadcrumb.Separator class="text-muted-foreground/30" />
									{/each}
									{@const fileSiblings = filesAt(dirSegments.join('/'))}
									<Breadcrumb.Item>
										<DropdownMenu.Root>
											<DropdownMenu.Trigger
												class="cursor-pointer truncate font-mono font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none"
											>
												{fileName}
											</DropdownMenu.Trigger>
											{#if fileSiblings.length > 1}
												<DropdownMenu.Content align="start" class="font-mono text-xs">
													{#each fileSiblings as f (f.path)}
														<DropdownMenu.Item
															onSelect={() => (activePath = f.path)}
															class={f.path === activeFile.path ? 'bg-primary/10 text-primary' : ''}
														>
															{leafName(f.path)}
														</DropdownMenu.Item>
													{/each}
												</DropdownMenu.Content>
											{/if}
										</DropdownMenu.Root>
									</Breadcrumb.Item>
								</Breadcrumb.List>
							</Breadcrumb.Root>
							<div class="ml-auto flex items-center gap-2">
								{#if saveState === 'saving'}
									<span class="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
										<CircleNotchIcon class="size-3 animate-spin" weight="bold" />
										saving
									</span>
								{:else if saveState === 'dirty'}
									<span class="flex items-center gap-1 font-mono text-[10px] text-warning">
										<span
											class="size-1.5 rounded-full bg-warning shadow-[0_0_6px_var(--warning)]"
											aria-hidden="true"
										></span>
										unsaved
									</span>
								{:else if saveState === 'error'}
									<span
										class="flex items-center gap-1 font-mono text-[10px] text-destructive"
										title={saveError ?? undefined}
									>
										<WarningCircleIcon class="size-3" weight="fill" />
										save failed
									</span>
								{:else}
									<span class="flex items-center gap-1 font-mono text-[10px] text-live">
										<CheckCircleIcon class="size-3" weight="fill" />
										saved
									</span>
								{/if}
								<span
									class="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary uppercase"
								>
									{activeFile.lang}
								</span>
							</div>
						{:else}
							<span class="text-xs text-muted-foreground italic">no file selected</span>
						{/if}
					</header>
					<div bind:this={host} class="min-h-0 flex-1 overflow-hidden"></div>
				</div>
			</Resizable.Pane>
		</Resizable.PaneGroup>
	{/if}
</section>
