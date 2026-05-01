<script lang="ts">
	import type { AgentEvent } from '@crucible/types';
	import EventFrame from './event-frame.svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import * as Code from '$lib/components/ai-elements/code';
	import type { SupportedLanguage } from '$lib/components/ai-elements/code/shiki';
	import ChevronIcon from '@lucide/svelte/icons/chevron-down';

	interface Props {
		event: Extract<AgentEvent, { type: 'file_write' }>;
	}

	let { event }: Props = $props();

	const SUPPORTED: ReadonlySet<string> = new Set([
		'bash',
		'diff',
		'javascript',
		'json',
		'svelte',
		'typescript',
		'python',
		'tsx',
		'jsx',
		'css',
		'text'
	]);

	function shikiLang(lang: string): SupportedLanguage {
		// `WorkspaceFileLang` is broader than the Shiki bundled set — map the
		// gaps (solidity, html, markdown, plaintext) onto safe defaults.
		const aliases: Record<string, SupportedLanguage> = {
			solidity: 'text',
			html: 'svelte',
			markdown: 'text',
			plaintext: 'text'
		};
		if (aliases[lang]) return aliases[lang]!;
		if (SUPPORTED.has(lang)) return lang as SupportedLanguage;
		return 'text';
	}
</script>

<EventFrame label="file_write" tone="info" seq={event.seq} emittedAt={event.emittedAt}>
	<Collapsible.Root>
		<Collapsible.Trigger
			class="group flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40"
		>
			<ChevronIcon
				class="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
			/>
			<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
				>{event.path}</code
			>
			<span class="text-xs tracking-wide text-muted-foreground uppercase">{event.lang}</span>
			<span class="ml-auto font-mono text-[10px] text-muted-foreground/70"
				>{event.hash.slice(0, 12)}…</span
			>
		</Collapsible.Trigger>
		<Collapsible.Content
			class="mt-2 overflow-hidden data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
		>
			{#if event.content}
				<Code.Root code={event.content} lang={shikiLang(event.lang)} variant="secondary" />
			{:else}
				<p class="px-1 font-mono text-[11px] text-muted-foreground italic">
					(content omitted — file too large to inline)
				</p>
			{/if}
		</Collapsible.Content>
	</Collapsible.Root>
</EventFrame>
