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
</script>

<script lang="ts">
	import * as TreeView from '$lib/components/ui/tree-view';
	import { cn } from '$lib/utils';

	interface Props {
		files: WorkspaceFile[];
		activePath: string | null | undefined;
		onSelect: (path: string) => void;
	}

	let { files, activePath, onSelect }: Props = $props();

	let nodes = $derived<TreeNode[]>(buildTree(files));
</script>

{#snippet renderNodes(items: TreeNode[])}
	{#each items as node (node.path)}
		{#if node.kind === 'dir'}
			<TreeView.Folder
				name={node.name}
				class="py-0.5 text-xs text-muted-foreground hover:text-foreground"
			>
				{@render renderNodes(node.children)}
			</TreeView.Folder>
		{:else}
			<TreeView.File
				name={node.name}
				class={cn(
					'rounded px-1 py-0.5 text-left text-xs transition-colors',
					node.path === activePath
						? 'bg-muted text-foreground'
						: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
				)}
				onclick={() => onSelect(node.path)}
			/>
		{/if}
	{/each}
{/snippet}

<TreeView.Root class="px-2 py-2 font-mono">
	{@render renderNodes(nodes)}
</TreeView.Root>
