<script lang="ts" module>
	import type { WorkspaceFile } from '@crucible/types';

	type DirNode = {
		kind: 'dir';
		name: string;
		path: string;
		children: TreeNode[];
	};

	type FileNode = {
		kind: 'file';
		name: string;
		path: string;
		file: WorkspaceFile;
	};

	type TreeNode = DirNode | FileNode;

	function buildTree(files: WorkspaceFile[]): TreeNode[] {
		const root: DirNode = { kind: 'dir', name: '', path: '', children: [] };

		for (const file of files) {
			const segments = file.path.split('/').filter((s) => s.length > 0);
			let cursor: DirNode = root;
			for (let i = 0; i < segments.length - 1; i += 1) {
				const seg = segments[i]!;
				const dirPath = segments.slice(0, i + 1).join('/');
				let child = cursor.children.find((c): c is DirNode => c.kind === 'dir' && c.name === seg);
				if (!child) {
					child = { kind: 'dir', name: seg, path: dirPath, children: [] };
					cursor.children.push(child);
				}
				cursor = child;
			}
			const leaf = segments[segments.length - 1]!;
			cursor.children.push({ kind: 'file', name: leaf, path: file.path, file });
		}

		const sortNodes = (nodes: TreeNode[]): void => {
			nodes.sort((a, b) => {
				if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
			for (const n of nodes) if (n.kind === 'dir') sortNodes(n.children);
		};
		sortNodes(root.children);
		return root.children;
	}

	/** Every ancestor directory path of a file (excluding the file itself). */
	function ancestorDirs(filePath: string): string[] {
		const segments = filePath.split('/').filter((s) => s.length > 0);
		const out: string[] = [];
		for (let i = 1; i < segments.length; i += 1) {
			out.push(segments.slice(0, i).join('/'));
		}
		return out;
	}
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { cn } from '$lib/utils';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import FileIcon from 'phosphor-svelte/lib/FileIcon';

	interface Props {
		files: WorkspaceFile[];
		activePath: string | null | undefined;
		onSelect: (path: string) => void;
		/**
		 * Shared set of expanded directory paths. Parent components (e.g. the
		 * breadcrumb in the editor header) mutate this to expand a particular
		 * folder into view. SvelteSet is reactive on mutation so both sides
		 * see updates without `bind:`.
		 */
		expandedPaths?: SvelteSet<string>;
	}

	let { files, activePath, onSelect, expandedPaths = new SvelteSet<string>() }: Props = $props();

	const nodes = $derived<TreeNode[]>(buildTree(files));

	// Whenever a different file becomes active, ensure all of its ancestor
	// directories are expanded so the user can see where the file lives in
	// the tree without manually drilling in.
	$effect(() => {
		if (!activePath) return;
		for (const dir of ancestorDirs(activePath)) {
			expandedPaths.add(dir);
		}
	});

	function toggleDir(path: string): void {
		if (expandedPaths.has(path)) {
			expandedPaths.delete(path);
		} else {
			expandedPaths.add(path);
		}
	}
</script>

{#snippet renderNodes(items: TreeNode[], depth: number)}
	{#each items as node (node.path)}
		{#if node.kind === 'file'}
			{@const isActive = node.path === activePath}
			<button
				type="button"
				onclick={() => onSelect(node.path)}
				class={cn(
					'flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left font-mono text-xs transition-colors',
					isActive
						? 'bg-primary/10 text-primary'
						: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
				)}
				style:padding-left="{0.375 + depth * 0.875}rem"
			>
				<FileIcon class="size-3.5 shrink-0" weight={isActive ? 'fill' : 'regular'} />
				<span class="truncate">{node.name}</span>
			</button>
		{:else}
			{@const isOpen = expandedPaths.has(node.path)}
			<Collapsible.Root open={isOpen} onOpenChange={() => toggleDir(node.path)}>
				<Collapsible.Trigger class="w-full">
					<div
						class="group/folder flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-left font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
						style:padding-left="{0.375 + depth * 0.875}rem"
					>
						<CaretRightIcon
							class={cn('size-3 shrink-0 transition-transform', isOpen && 'rotate-90')}
							weight="bold"
						/>
						{#if isOpen}
							<FolderOpenIcon class="size-3.5 shrink-0" weight="fill" />
						{:else}
							<FolderIcon class="size-3.5 shrink-0" weight="fill" />
						{/if}
						<span class="truncate">{node.name}</span>
					</div>
				</Collapsible.Trigger>
				<Collapsible.Content>
					{@render renderNodes(node.children, depth + 1)}
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
	{/each}
{/snippet}

<div class="flex flex-col gap-px px-1.5 py-2">
	{@render renderNodes(nodes, 0)}
</div>
