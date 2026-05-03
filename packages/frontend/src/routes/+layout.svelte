<script lang="ts">
	import './layout.css';

	let { children } = $props();
</script>

<svelte:head>
	<title
		>Crucible - Describe a dApp. An agent writes, compiles, deploys, and self-heals it. Live in your
		browser.</title
	>
	<meta
		name="description"
		content="Crucible is a browser-based agentic development environment for Web3. You describe the dApp you want. The agent writes the Solidity and frontend code, compiles it, spins up a local Hardhat chain, deploys, and loads a live interactive preview, all in one unified workspace. "
	/>
</svelte:head>

{@render children()}
