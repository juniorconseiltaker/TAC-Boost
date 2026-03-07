<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import UsersIcon from '@lucide/svelte/icons/users';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';

	let { data } = $props();

	function formatDate(date: string | null): string {
		if (!date) return '-';
		return new Date(date).toLocaleString('fr-FR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatMode(mode: 'organisationnel' | 'tresorerie'): string {
		return mode === 'organisationnel' ? 'Organisationnel' : 'Trésorerie';
	}

	function selectSession(id: number) {
		const url = new URL($page.url);
		url.searchParams.set('session', id.toString());
		goto(url);
	}
</script>

<div class="space-y-6 mt-8">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-bold text-[#122555]">Sessions de test</h2>
	</div>

	{#if data.history.length === 0}
		<div class="bg-white rounded-2xl border border-[#122555]/10 p-8 text-center text-[#122555]/60">
			Aucune session de test n'a encore été créée.
		</div>
	{:else}
		<div class="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
			<div
				class="bg-white rounded-2xl border border-[#122555]/10 shadow-sm p-4 space-y-3 max-h-[75vh] overflow-y-auto"
			>
				{#each data.history as session (session.id)}
					<button
						onclick={() => selectSession(session.id)}
						class="w-full text-left rounded-xl border p-4 transition-colors {data.selectedSessionId ===
						session.id
							? 'border-[#122555] bg-[#122555]/5'
							: 'border-[#122555]/10 hover:bg-[#122555]/5'}"
					>
						<div class="flex items-center justify-between mb-2">
							<p class="font-semibold text-[#122555]">PIN {session.pin}</p>
							<span
								class="text-xs px-2 py-1 rounded-full font-medium {session.status === 'completed'
									? 'bg-green-100 text-green-700'
									: session.status === 'started'
										? 'bg-blue-100 text-blue-700'
										: 'bg-amber-100 text-amber-700'}"
							>
								{session.status}
							</span>
						</div>
						<p class="text-sm text-[#122555]/70 mb-1">{formatMode(session.examMode)}</p>
						<p class="text-xs text-[#122555]/60">
							{session.participantCount} participants • {session.submittedCount} rendus
						</p>
						<p class="text-xs text-[#122555]/50 mt-1">
							Créée le {formatDate(session.createdAt)} par {session.createdByName}
						</p>
					</button>
				{/each}
			</div>

			{#if data.selectedSession}
				<div class="space-y-6">
					<div class="bg-white rounded-2xl border border-[#122555]/10 shadow-sm p-6">
						<div class="flex flex-wrap items-center justify-between gap-4 mb-5">
							<div>
								<h3 class="text-2xl font-bold text-[#122555]">
									Session PIN {data.selectedSession.pin}
								</h3>
								<p class="text-[#122555]/60">
									{formatMode(data.selectedSession.examMode)} • {data.selectedSession.questionCount} questions
									• {Math.round(data.selectedSession.timeLimitSeconds / 60)} min
								</p>
							</div>
							<span
								class="text-sm px-3 py-1.5 rounded-full font-semibold {data.selectedSession
									.status === 'completed'
									? 'bg-green-100 text-green-700'
									: data.selectedSession.status === 'started'
										? 'bg-blue-100 text-blue-700'
										: 'bg-amber-100 text-amber-700'}"
							>
								{data.selectedSession.status}
							</span>
						</div>

						<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
							<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
								<p class="text-xs uppercase tracking-wide text-[#122555]/60">Créée</p>
								<p class="font-semibold text-[#122555]">
									{formatDate(data.selectedSession.createdAt)}
								</p>
							</div>
							<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
								<p class="text-xs uppercase tracking-wide text-[#122555]/60">Démarrée</p>
								<p class="font-semibold text-[#122555]">
									{formatDate(data.selectedSession.startedAt)}
								</p>
							</div>
							<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
								<p class="text-xs uppercase tracking-wide text-[#122555]/60">Terminée</p>
								<p class="font-semibold text-[#122555]">
									{formatDate(data.selectedSession.endedAt)}
								</p>
							</div>
							<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
								<p class="text-xs uppercase tracking-wide text-[#122555]/60">Admin</p>
								<p class="font-semibold text-[#122555]">{data.selectedSession.createdByName}</p>
							</div>
						</div>
					</div>

					<div class="bg-white rounded-2xl border border-[#122555]/10 shadow-sm p-6">
						<h4 class="text-xl font-bold text-[#122555] mb-4 flex items-center gap-2">
							<UsersIcon class="w-5 h-5" />
							Résultats des membres
						</h4>
						<div class="overflow-x-auto">
							<table class="w-full text-sm">
								<thead>
									<tr class="border-b border-[#122555]/10 text-[#122555]/60">
										<th class="text-left py-2">Membre</th>
										<th class="text-left py-2">Statut</th>
										<th class="text-left py-2">Score</th>
										<th class="text-left py-2">Correctes</th>
										<th class="text-left py-2">Temps</th>
										<th class="text-left py-2">Soumis le</th>
									</tr>
								</thead>
								<tbody>
									{#each data.selectedSession.participants as participant (participant.userId)}
										<tr class="border-b border-[#122555]/5">
											<td class="py-3 font-medium text-[#122555]">{participant.userName}</td>
											<td class="py-3">
												{#if participant.hasSubmitted}
													<span
														class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium"
														>Terminé</span
													>
												{:else}
													<span
														class="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full font-medium"
														>En attente</span
													>
												{/if}
											</td>
											<td class="py-3">{participant.score ?? '-'}</td>
											<td class="py-3">
												{participant.correctAnswers !== undefined &&
												participant.totalQuestions !== undefined
													? `${participant.correctAnswers}/${participant.totalQuestions}`
													: '-'}
											</td>
											<td class="py-3">
												{participant.timeSpent !== undefined
													? `${Math.floor(participant.timeSpent / 60)}:${(participant.timeSpent % 60).toString().padStart(2, '0')}`
													: '-'}
											</td>
											<td class="py-3">{formatDate(participant.submittedAt)}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
						<div class="bg-white rounded-2xl border border-[#122555]/10 shadow-sm p-6">
							<h4 class="text-xl font-bold text-[#122555] mb-4">Catégories les mieux réussies</h4>
							<div class="space-y-3">
								{#each data.selectedSession.categoryPerformance || [] as category (category.name)}
									<div>
										<div class="flex justify-between text-sm mb-1">
											<span class="font-medium text-[#122555]">{category.name}</span>
											<span class="text-[#122555]/60">{category.successRate}%</span>
										</div>
										<div class="h-2 w-full bg-[#122555]/10 rounded-full overflow-hidden">
											<div
												class="h-full bg-[#122555] rounded-full"
												style="width: {category.successRate}%"
											></div>
										</div>
									</div>
								{/each}
								{#if (data.selectedSession.categoryPerformance || []).length === 0}
									<p class="text-sm text-[#122555]/60 italic">Pas assez de données</p>
								{/if}
							</div>
						</div>

						<div class="space-y-6">
							<div class="bg-white rounded-2xl border border-green-200 shadow-sm p-6">
								<h4 class="text-lg font-bold text-green-700 mb-4 flex items-center gap-2">
									<TrendingUpIcon class="w-5 h-5" />
									Top 5 questions réussies
								</h4>
								<div class="space-y-3">
									{#each data.selectedSession.topQuestions || [] as question, index (`top-${index}`)}
										<div class="rounded-lg border border-green-100 p-3">
											<p class="text-sm font-medium text-[#122555] line-clamp-2">
												{question.question}
											</p>
											<p class="text-xs text-green-700 mt-1">
												{question.successRate}% réussite ({question.count} essais)
											</p>
										</div>
									{/each}
									{#if (data.selectedSession.topQuestions || []).length === 0}
										<p class="text-sm text-[#122555]/60 italic">Pas assez de données</p>
									{/if}
								</div>
							</div>

							<div class="bg-white rounded-2xl border border-red-200 shadow-sm p-6">
								<h4 class="text-lg font-bold text-red-700 mb-4 flex items-center gap-2">
									<TrendingDownIcon class="w-5 h-5" />
									Top 5 questions échouées
								</h4>
								<div class="space-y-3">
									{#each data.selectedSession.flopQuestions || [] as question, index (`flop-${index}`)}
										<div class="rounded-lg border border-red-100 p-3">
											<p class="text-sm font-medium text-[#122555] line-clamp-2">
												{question.question}
											</p>
											<p class="text-xs text-red-700 mt-1">
												{question.successRate}% réussite ({question.count} essais)
											</p>
										</div>
									{/each}
									{#if (data.selectedSession.flopQuestions || []).length === 0}
										<p class="text-sm text-[#122555]/60 italic">Pas assez de données</p>
									{/if}
								</div>
							</div>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
