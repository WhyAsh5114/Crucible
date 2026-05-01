<script lang="ts">
	/**
	 * Streamdown's `components.code` adapter — receives a `Tokens.Code` token
	 * (from the bundled `marked` parser) and renders it through the
	 * shadcn-svelte-extras style `Code.svelte`, which uses Shiki for syntax
	 * highlighting.
	 *
	 * The token shape is structurally typed here instead of imported from
	 * `marked` (a transitive dep of svelte-streamdown) — only `text` and
	 * `lang` are needed and they're stable across marked versions.
	 *
	 * `lang` may be any string from the source markdown — we map unsupported
	 * languages to `text` so the Shiki bundled-language list stays the source
	 * of truth.
	 */
	import * as Code from '$lib/components/ai-elements/code';
	import type { SupportedLanguage } from '$lib/components/ai-elements/code/shiki';

	interface Props {
		token: { text: string; lang?: string };
		id: string;
	}

	let { token }: Props = $props();

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

	function resolveLang(raw: string | undefined): SupportedLanguage {
		if (!raw) return 'text';
		const normalised = raw.toLowerCase();
		const aliases: Record<string, SupportedLanguage> = {
			ts: 'typescript',
			js: 'javascript',
			py: 'python',
			sh: 'bash',
			shell: 'bash',
			html: 'svelte',
			md: 'text',
			markdown: 'text',
			plaintext: 'text',
			plain: 'text',
			sol: 'text',
			solidity: 'text'
		};
		if (aliases[normalised]) return aliases[normalised]!;
		if (SUPPORTED.has(normalised)) return normalised as SupportedLanguage;
		return 'text';
	}

	let lang = $derived(resolveLang(token.lang));
</script>

<Code.Root code={token.text} {lang} class="my-3" />
