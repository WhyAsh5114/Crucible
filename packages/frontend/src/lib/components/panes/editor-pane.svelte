<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { Component } from 'svelte';
	import type { WorkspaceFile, WorkspaceState } from '@crucible/types';
	import EmptyState from '$lib/components/empty-state.svelte';
	import FileTree from '$lib/components/file-tree.svelte';
	import * as Resizable from '$lib/components/ui/resizable';
	import { getAgentStream } from '$lib/state/agent-stream.svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import FileTsIcon from 'phosphor-svelte/lib/FileTsIcon';
	import FileJsIcon from 'phosphor-svelte/lib/FileJsIcon';
	import FileCssIcon from 'phosphor-svelte/lib/FileCssIcon';
	import FileHtmlIcon from 'phosphor-svelte/lib/FileHtmlIcon';
	import FileMdIcon from 'phosphor-svelte/lib/FileMdIcon';
	import FileCodeIcon from 'phosphor-svelte/lib/FileCodeIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import BracketsCurlyIcon from 'phosphor-svelte/lib/BracketsCurlyIcon';
	import CubeIcon from 'phosphor-svelte/lib/CubeIcon';

	// Maps WorkspaceFile['lang'] → phosphor icon component. Solidity uses
	// the Cube icon to lean into the smart-contract / EVM bytecode metaphor;
	// everything else picks the closest dedicated phosphor file icon, falling
	// back to FileCode / FileText for unspecific languages.
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
	} | null>(null);

	// Merge the workspace's initial snapshot with live `file_write` events from
	// the agent stream so the editor + file tree update the moment the agent
	// writes a file — without a manual refresh. The snapshot from
	// `getWorkspace()` is only fresh on mount; everything after relies on SSE.
	// `file_write.content` is omitted for very large files (per the schema);
	// in that case we keep the snapshot version and bump `modifiedAt` so the
	// file tree at least reflects that something changed.
	let files = $derived.by<WorkspaceFile[]>(() => {
		const map = new SvelteMap<string, WorkspaceFile>();
		for (const f of workspace?.files ?? []) map.set(f.path, f);
		for (const ev of stream.events) {
			if (ev.type !== 'file_write') continue;
			const existing = map.get(ev.path);
			map.set(ev.path, {
				path: ev.path,
				content: ev.content ?? existing?.content ?? '',
				lang: ev.lang,
				hash: ev.hash,
				modifiedAt: ev.emittedAt
			});
		}
		return [...map.values()];
	});
	let activePath = $state<string | null>(null);
	let activeFile = $derived<WorkspaceFile | null>(
		files.find((f) => f.path === activePath) ?? files[0] ?? null
	);

	$effect(() => {
		if (editor && activeFile) {
			editor.setDoc(activeFile.content, activeFile.lang);
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
					keymap.of([...defaultKeymap, ...historyKeymap]),
					cssVarTheme,
					EditorView.editable.of(false),
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
			}
		};
	});

	onDestroy(() => {
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
							{@const segments = activeFile.path.split('/').filter((s) => s.length > 0)}
							{@const dirSegments = segments.slice(0, -1)}
							{@const fileName = segments.at(-1) ?? activeFile.path}
							<LangIcon class="size-4 shrink-0 text-primary" weight="fill" />
							<div class="flex min-w-0 items-center gap-1 overflow-hidden font-mono text-xs">
								{#each dirSegments as seg, i (i)}
									<span class="truncate text-muted-foreground/70">{seg}</span>
									<span class="text-muted-foreground/30">/</span>
								{/each}
								<span class="truncate font-medium text-foreground">{fileName}</span>
							</div>
							<span
								class="ml-auto rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary uppercase"
							>
								{activeFile.lang}
							</span>
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
