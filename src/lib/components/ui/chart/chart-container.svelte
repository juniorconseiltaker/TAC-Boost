<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ChartConfig } from './index.js';

	let {
		config,
		class: className = '',
		children
	}: { config: ChartConfig; class?: string; children?: Snippet } = $props();

	void config;
</script>

<div class="w-full h-full {className}">
	{@render children?.()}
</div>
