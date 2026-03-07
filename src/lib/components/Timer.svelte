<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { timeRemaining, totalTime, isQuizActive } from '$lib/stores.js';
	import { formatTime } from '$lib/quiz.js';

	let { onTimeUp } = $props<{ onTimeUp: () => void }>();

	let interval: number;

	onMount(() => {
		interval = setInterval(() => {
			if ($isQuizActive && $timeRemaining > 0) {
				const nextTime = $timeRemaining - 1;
				timeRemaining.set(nextTime);

				if (nextTime === 0) {
					onTimeUp();
				}
			}
		}, 1000);
	});

	onDestroy(() => {
		if (interval) {
			clearInterval(interval);
		}
	});

	const timeColor = $derived(
		$timeRemaining <= 300
			? 'text-red-600'
			: $timeRemaining <= 900
				? 'text-amber-600'
				: 'text-[#122555]'
	);
	const progressWidth = $derived($totalTime > 0 ? ($timeRemaining / $totalTime) * 100 : 0);
	const isWarning = $derived($timeRemaining <= 300); // Last 5 minutes
</script>

<div class="bg-white rounded-xl shadow-lg p-4 border border-[#122555]/10">
	<div class="flex items-center justify-between mb-3">
		<h3 class="text-lg font-semibold text-[#122555]">Temps restant</h3>
		<div class="{timeColor} text-2xl font-mono font-bold {isWarning ? 'animate-pulse' : ''}">
			{formatTime($timeRemaining)}
		</div>
	</div>

	<div class="w-full bg-[#122555]/10 rounded-full h-3 overflow-hidden">
		<div
			class="h-full transition-all duration-1000 ease-linear {$timeRemaining <= 300
				? 'bg-red-500'
				: $timeRemaining <= 900
					? 'bg-amber-500'
					: 'bg-[#122555]'}"
			style="width: {progressWidth}%"
		></div>
	</div>

	{#if $timeRemaining <= 300}
		<p class="text-red-600 text-sm font-medium mt-2 animate-pulse">
			⚠️ Attention : Plus que 5 minutes !
		</p>
	{:else if $timeRemaining <= 900}
		<p class="text-amber-600 text-sm font-medium mt-2">⏰ Plus que 15 minutes</p>
	{/if}
</div>
