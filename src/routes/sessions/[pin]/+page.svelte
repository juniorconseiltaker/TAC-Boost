<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { Session } from '@auth/core/types';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import Timer from '$lib/components/Timer.svelte';
	import QuestionCard from '$lib/components/QuestionCard.svelte';
	import {
		currentQuiz,
		currentQuestionIndex,
		quizAnswers,
		quizStartTime,
		timeRemaining,
		totalTime,
		isQuizActive,
		quizResult,
		currentExamMode,
		resetQuizState
	} from '$lib/stores.js';
	import { calculateResult, formatTime } from '$lib/quiz.js';
	import type { Question, QuizResult } from '$lib/types.js';
	import UsersIcon from '@lucide/svelte/icons/users';
	import PlayIcon from '@lucide/svelte/icons/play';
	import Clock3Icon from '@lucide/svelte/icons/clock-3';
	import TrophyIcon from '@lucide/svelte/icons/trophy';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import TrendingDownIcon from '@lucide/svelte/icons/trending-down';

	interface SessionParticipant {
		userId: string;
		userName: string;
		userImage: string | null;
		joinedAt: string;
		currentQuestionIndex: number;
		progressUpdatedAt: string | null;
		hasSubmitted: boolean;
		submittedAt: string | null;
		score?: number;
		correctAnswers?: number;
		totalQuestions?: number;
		timeSpent?: number;
	}

	interface SessionStat {
		name: string;
		successRate: number;
		totalAnswers: number;
	}

	interface SessionQuestionStat {
		question: string;
		successRate: number;
		count: number;
	}

	interface SessionResultView {
		score: number;
		correctAnswers: number;
		totalQuestions: number;
		timeSpent: number;
		submittedAt: string;
	}

	interface SessionView {
		id: number;
		pin: string;
		examMode: 'organisationnel' | 'tresorerie';
		status: 'waiting' | 'started' | 'completed' | 'cancelled';
		questionCount: number;
		timeLimitSeconds: number;
		createdAt: string;
		startedAt: string | null;
		endedAt: string | null;
		createdByUserId: string;
		createdByName: string;
		isCreator: boolean;
		participants: SessionParticipant[];
		myResult: SessionResultView | null;
		quizPayload?: Question[];
		categoryPerformance?: SessionStat[];
		topQuestions?: SessionQuestionStat[];
		flopQuestions?: SessionQuestionStat[];
	}

	let {
		data
	}: {
		data: { session: Session; isUserAdmin: boolean; testSession: SessionView };
	} = $props();
	const getInitialSession = () => data.testSession;

	let liveSession = $state<SessionView>(getInitialSession());
	let showQuiz = $state(false);
	let showResults = $state(false);
	let sessionQuizInitialized = $state(false);
	let localResult = $state<QuizResult | null>(null);
	let loadingAction = $state(false);
	let submittingResult = $state(false);
	let errorMessage = $state<string | null>(null);
	let resultMessage = $state<string | null>(null);
	let lastReportedQuestion = $state<number | null>(null);
	let pollInterval: number | null = null;

	const pendingParticipants = $derived(
		liveSession.participants.filter((participant) => !participant.hasSubmitted)
	);
	const resultToDisplay = $derived.by(() => {
		if (localResult) {
			return {
				score: localResult.score,
				correctAnswers: localResult.answers.filter((answer) => answer.isCorrect).length,
				totalQuestions: localResult.totalQuestions,
				timeSpent: Math.round(localResult.timeSpent)
			};
		}
		return liveSession.myResult;
	});

	function modeLabel(mode: 'organisationnel' | 'tresorerie'): string {
		return mode === 'organisationnel' ? 'TAC1 Organisationnel' : 'TAC1 Trésorerie';
	}

	function parseSessionTimestamp(value: string | null): number | null {
		if (!value) return null;
		const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
			? `${value.replace(' ', 'T')}Z`
			: value;
		const ms = new Date(normalized).getTime();
		return Number.isNaN(ms) ? null : ms;
	}

	function formatDateTime(date: string | null): string {
		if (!date) return '-';
		const timestamp = parseSessionTimestamp(date);
		if (!timestamp) return '-';
		return new Date(timestamp).toLocaleString('fr-FR', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	async function refreshSession() {
		try {
			const response = await fetch(`/api/test-sessions/${liveSession.pin}`);
			const payload = await response.json();
			if (!response.ok) {
				errorMessage = payload.error || 'Impossible de rafraîchir la session.';
				return;
			}
			liveSession = payload.session as SessionView;
		} catch {
			errorMessage = 'Erreur réseau pendant la mise à jour.';
		}
	}

	async function reportParticipantProgress(currentQuestion: number) {
		if (liveSession.isCreator) return;
		try {
			await fetch(`/api/test-sessions/${liveSession.pin}/progress`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentQuestion })
			});
		} catch {
			// Best-effort only: keep quiz flow resilient even if progress sync fails.
		}
	}

	async function startSession() {
		loadingAction = true;
		errorMessage = null;
		try {
			const response = await fetch(`/api/test-sessions/${liveSession.pin}/start`, {
				method: 'POST'
			});
			const payload = await response.json();
			if (!response.ok) {
				errorMessage = payload.error || 'Impossible de lancer la session.';
				return;
			}
			await refreshSession();
		} catch {
			errorMessage = 'Erreur réseau pendant le lancement.';
		} finally {
			loadingAction = false;
		}
	}

	function initializeSessionQuiz(payload: Question[]) {
		const startedAtMs = parseSessionTimestamp(liveSession.startedAt);
		const elapsedSeconds = startedAtMs
			? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
			: 0;
		const remainingSeconds = Math.max(0, liveSession.timeLimitSeconds - elapsedSeconds);

		resetQuizState();
		currentQuiz.set(payload);
		currentQuestionIndex.set(0);
		quizAnswers.set([]);
		quizStartTime.set(Date.now());
		timeRemaining.set(remainingSeconds);
		totalTime.set(liveSession.timeLimitSeconds);
		currentExamMode.set('custom');
		isQuizActive.set(true);
		localResult = null;
		showQuiz = true;
		showResults = false;
		sessionQuizInitialized = true;
		lastReportedQuestion = null;
		resultMessage = null;

		if (remainingSeconds === 0) {
			queueMicrotask(() => {
				handleQuizComplete();
			});
		}
	}

	async function submitMyResult(result: QuizResult) {
		if (submittingResult) return;
		submittingResult = true;
		resultMessage = null;
		errorMessage = null;

		try {
			const response = await fetch(`/api/test-sessions/${liveSession.pin}/submit`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					score: result.score,
					totalQuestions: result.totalQuestions,
					correctAnswers: result.answers.filter((answer) => answer.isCorrect).length,
					timeSpent: Math.round(result.timeSpent),
					categoryScores: result.categoryScores,
					questionResults: result.answers.map((answer) => ({
						questionId: answer.questionId,
						isCorrect: answer.isCorrect
					}))
				})
			});
			const payload = await response.json();
			if (!response.ok) {
				errorMessage = payload.error || 'Impossible d’envoyer vos résultats.';
				return;
			}
			resultMessage = 'Résultat envoyé.';
			await refreshSession();
		} catch {
			errorMessage = 'Erreur réseau lors de l’envoi du résultat.';
		} finally {
			submittingResult = false;
		}
	}

	async function handleQuizComplete() {
		if (!showQuiz) return;

		isQuizActive.set(false);
		if (!liveSession.isCreator) {
			await reportParticipantProgress(liveSession.questionCount);
		}

		let result = $quizResult;
		if (!result) {
			const spent = ($quizStartTime ? Date.now() - $quizStartTime : 0) / 1000;
			result = calculateResult($currentQuiz, $quizAnswers, spent);
			quizResult.set(result);
		}

		localResult = result;
		showQuiz = false;
		showResults = true;
		await submitMyResult(result);
	}

	$effect(() => {
		if (
			liveSession.status === 'started' &&
			!liveSession.isCreator &&
			!liveSession.myResult &&
			!showQuiz &&
			!showResults &&
			!sessionQuizInitialized &&
			liveSession.quizPayload
		) {
			initializeSessionQuiz(liveSession.quizPayload);
		}
	});

	$effect(() => {
		if (!showQuiz || liveSession.isCreator || !sessionQuizInitialized) return;
		if ($currentQuiz.length === 0) return;

		const currentQuestion = Math.max(
			1,
			Math.min(liveSession.questionCount, Math.floor($currentQuestionIndex + 1))
		);
		if (lastReportedQuestion === currentQuestion) return;

		lastReportedQuestion = currentQuestion;
		void reportParticipantProgress(currentQuestion);
	});

	function getParticipantProgressPercent(participant: SessionParticipant): number {
		if (participant.hasSubmitted) return 100;
		if (liveSession.questionCount <= 0) return 0;
		const clamped = Math.max(
			0,
			Math.min(liveSession.questionCount, Math.floor(participant.currentQuestionIndex || 0))
		);
		return Math.round((clamped / liveSession.questionCount) * 100);
	}

	function getParticipantStageLabel(participant: SessionParticipant): string {
		if (participant.hasSubmitted) return 'Terminé';
		if (liveSession.status !== 'started') return 'En attente';
		const currentQuestion = Math.max(
			0,
			Math.min(liveSession.questionCount, Math.floor(participant.currentQuestionIndex || 0))
		);
		if (currentQuestion === 0) return 'Démarrage';
		return `Question ${currentQuestion}/${liveSession.questionCount}`;
	}

	$effect(() => {
		if (!showQuiz && !showResults && liveSession.myResult) {
			showResults = true;
		}
	});

	$effect(() => {
		if (typeof window === 'undefined') return;
		if (pollInterval) {
			window.clearInterval(pollInterval);
		}
		pollInterval = window.setInterval(() => {
			refreshSession();
		}, 2000);

		return () => {
			if (pollInterval) {
				window.clearInterval(pollInterval);
				pollInterval = null;
			}
		};
	});

	onDestroy(() => {
		if (pollInterval) {
			window.clearInterval(pollInterval);
		}
		resetQuizState();
	});
</script>

<div class="min-h-screen bg-gradient-to-br from-white via-slate-50 to-[#122555]/5">
	<div class="container mx-auto px-4 py-8">
		<header class="flex justify-between items-center mb-8">
			<div>
				<a
					href="/sessions"
					class="text-[#122555] hover:text-[#122555]/70 flex items-center gap-2 mb-3"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
					Retour aux sessions
				</a>
				<h1 class="text-3xl font-bold text-[#122555] mb-2 flex items-center gap-3">
					<UsersIcon class="w-7 h-7" />
					Session #{liveSession.pin}
				</h1>
				<p class="text-[#122555]/60">
					{modeLabel(liveSession.examMode)} • {liveSession.questionCount} questions • {Math.round(
						liveSession.timeLimitSeconds / 60
					)} min
				</p>
			</div>
			<UserMenu session={data.session} isAdmin={data.isUserAdmin} />
		</header>

		{#if errorMessage}
			<div class="max-w-5xl mx-auto mb-6">
				<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
					{errorMessage}
				</div>
			</div>
		{/if}
		{#if resultMessage}
			<div class="max-w-5xl mx-auto mb-6">
				<div class="bg-green-50 border border-green-200 text-green-700 rounded-xl px-4 py-3">
					{resultMessage}
				</div>
			</div>
		{/if}

		{#if showQuiz}
			<div class="max-w-4xl mx-auto">
				<div class="mb-6">
					<Timer onTimeUp={handleQuizComplete} />
				</div>
				<QuestionCard onComplete={handleQuizComplete} />
			</div>
		{:else}
			<div class="max-w-5xl mx-auto space-y-6">
				{#if liveSession.status === 'waiting'}
					<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
						<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
							<div>
								<p class="text-sm uppercase tracking-wide text-[#122555]/60">Statut</p>
								<p class="text-xl font-bold text-[#122555]">En attente du lancement</p>
								<p class="text-sm text-[#122555]/60 mt-1">
									Créée par {liveSession.createdByName} • {formatDateTime(liveSession.createdAt)}
								</p>
							</div>
							<div
								class="rounded-xl border border-[#122555]/20 bg-[#122555]/5 px-6 py-4 text-center"
							>
								<p class="text-xs uppercase tracking-wide text-[#122555]/70">Code PIN</p>
								<p class="text-4xl font-mono font-bold tracking-[0.3em] text-[#122555]">
									{liveSession.pin}
								</p>
							</div>
						</div>

						<div class="mb-6">
							<p class="text-sm text-[#122555]/70 mb-2">
								{liveSession.participants.length} participant{liveSession.participants.length > 1
									? 's'
									: ''}
								connecté{liveSession.participants.length > 1 ? 's' : ''}
							</p>
							<div class="space-y-2">
								{#each liveSession.participants as participant (participant.userId)}
									<div
										class="flex items-center justify-between rounded-xl border border-[#122555]/10 px-4 py-3"
									>
										<div class="flex items-center gap-3">
											{#if participant.userImage}
												<img
													src={participant.userImage}
													alt={participant.userName}
													class="w-10 h-10 rounded-full"
												/>
											{:else}
												<div
													class="w-10 h-10 rounded-full bg-[#122555] text-white flex items-center justify-center font-semibold"
												>
													{participant.userName.charAt(0).toUpperCase()}
												</div>
											{/if}
											<div>
												<p class="font-medium text-[#122555]">
													{participant.userName}
													{#if participant.userId === data.session.user?.id}
														<span class="text-xs text-[#122555]/60 ml-1">(Vous)</span>
													{/if}
												</p>
												<p class="text-xs text-[#122555]/60">
													Connecté à {formatDateTime(participant.joinedAt)}
												</p>
											</div>
										</div>
										{#if liveSession.isCreator && participant.userId === liveSession.createdByUserId}
											<span
												class="text-xs bg-[#122555]/10 text-[#122555] px-2 py-1 rounded-full font-medium"
												>Admin</span
											>
										{/if}
									</div>
								{/each}
							</div>
						</div>

						{#if liveSession.isCreator}
							<button
								onclick={startSession}
								disabled={loadingAction || liveSession.participants.length === 0}
								class="w-full rounded-xl bg-[#122555] hover:bg-[#0d1a3d] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors flex items-center justify-center gap-2"
							>
								<PlayIcon class="w-5 h-5" />
								{loadingAction ? 'Lancement...' : 'Lancer le test pour tout le monde'}
							</button>
						{:else}
							<div
								class="rounded-xl border border-[#122555]/15 bg-[#122555]/5 px-4 py-3 text-sm text-[#122555]/70"
							>
								En attente que l’admin lance le test.
							</div>
						{/if}
					</div>
				{/if}

				{#if showResults}
					<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
						<h2 class="text-2xl font-bold text-[#122555] mb-4 flex items-center gap-2">
							<TrophyIcon class="w-6 h-6" />
							Votre résultat
						</h2>

						{#if resultToDisplay}
							<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
								<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Score</p>
									<p class="text-4xl font-bold text-[#122555]">{resultToDisplay.score}%</p>
								</div>
								<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Correctes</p>
									<p class="text-2xl font-bold text-[#122555]">
										{resultToDisplay.correctAnswers}/{resultToDisplay.totalQuestions}
									</p>
								</div>
								<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Temps</p>
									<p class="text-2xl font-bold text-[#122555]">
										{formatTime(resultToDisplay.timeSpent)}
									</p>
								</div>
								<div class="rounded-xl bg-[#122555]/5 p-4 text-center">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Statut</p>
									<p class="text-sm font-semibold text-[#122555]">
										{liveSession.status === 'completed'
											? 'Session terminée'
											: 'Résultat enregistré'}
									</p>
								</div>
							</div>
						{:else if submittingResult}
							<p class="text-[#122555]/70">Envoi du résultat en cours...</p>
						{:else}
							<p class="text-[#122555]/70">Résultat indisponible pour le moment.</p>
						{/if}
					</div>
				{/if}

				{#if liveSession.isCreator}
					<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
						<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-5">
							<div>
								<h2 class="text-2xl font-bold text-[#122555]">Suivi des participants</h2>
								<p class="text-sm text-[#122555]/60">
									{liveSession.participants.length - pendingParticipants.length} / {liveSession
										.participants.length}
									résultats reçus
								</p>
							</div>
							<div
								class="rounded-xl border border-[#122555]/20 bg-[#122555]/5 px-4 py-3 text-sm text-[#122555]"
							>
								<Clock3Icon class="w-4 h-4 inline mr-1" />
								Démarrée: {formatDateTime(liveSession.startedAt)}
							</div>
						</div>

						<div class="overflow-x-auto">
							<table class="w-full min-w-[820px] text-sm">
								<thead>
									<tr class="border-b border-[#122555]/10 text-[#122555]/60">
										<th class="text-left py-2">Membre</th>
										<th class="text-left py-2 w-[280px]">Progression</th>
										<th class="text-left py-2 w-[140px]">Statut</th>
										<th class="text-left py-2">Score</th>
										<th class="text-left py-2">Correctes</th>
										<th class="text-left py-2">Temps</th>
									</tr>
								</thead>
								<tbody>
									{#each liveSession.participants as participant (participant.userId)}
										<tr class="border-b border-[#122555]/5">
											<td class="py-3 font-medium text-[#122555]">{participant.userName}</td>
											<td class="py-3 min-w-[220px] pr-6">
												<div class="space-y-1">
													<div
														class="flex items-center justify-between gap-4 text-xs text-[#122555]/70"
													>
														<span>{getParticipantStageLabel(participant)}</span>
														<span class="font-semibold tabular-nums whitespace-nowrap"
															>{getParticipantProgressPercent(participant)}%</span
														>
													</div>
													<div class="h-2.5 w-full rounded-full bg-[#122555]/10 overflow-hidden">
														<div
															class="h-full rounded-full transition-all duration-500 {participant.hasSubmitted
																? 'bg-green-500'
																: 'bg-[#122555]'}"
															style="width: {getParticipantProgressPercent(participant)}%"
														></div>
													</div>
												</div>
											</td>
											<td class="py-3 pl-4">
												{#if participant.hasSubmitted}
													<span
														class="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium"
														>Terminé</span
													>
												{:else if liveSession.status === 'started'}
													<span
														class="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium"
														>En cours</span
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
													? formatTime(participant.timeSpent)
													: '-'}
											</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>

					{#if (liveSession.categoryPerformance?.length || 0) > 0}
						<div class="space-y-6">
							<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
								<h3 class="text-xl font-bold text-[#122555] mb-4">Catégories les mieux réussies</h3>
								<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
									{#each liveSession.categoryPerformance || [] as category (category.name)}
										<div class="rounded-xl border border-[#122555]/10 bg-[#122555]/[0.02] p-4">
											<div class="flex items-center justify-between gap-3">
												<p class="font-semibold text-[#122555]">{category.name}</p>
												<p class="text-sm font-semibold text-[#122555]/70">
													{category.successRate}%
												</p>
											</div>
											<div class="mt-3 h-2.5 w-full bg-[#122555]/10 rounded-full overflow-hidden">
												<div
													class="h-full bg-[#122555] rounded-full"
													style="width: {category.successRate}%"
												></div>
											</div>
											<p class="mt-2 text-xs text-[#122555]/60">
												{category.totalAnswers} réponses analysées
											</p>
										</div>
									{/each}
								</div>
							</div>

							<div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
								<div class="bg-white rounded-2xl shadow-xl border border-green-200 p-6">
									<h3 class="text-lg font-bold text-green-700 mb-4 flex items-center gap-2">
										<TrendingUpIcon class="w-5 h-5" />
										Top 5 questions réussies
									</h3>
									<div class="space-y-3">
										{#each liveSession.topQuestions || [] as question, index (`top-${index}`)}
											<div class="rounded-lg border border-green-100 p-3">
												<p class="text-sm font-medium text-[#122555] line-clamp-2">
													{question.question}
												</p>
												<p class="text-xs text-green-700 mt-1">
													{question.successRate}% réussite ({question.count} essais)
												</p>
											</div>
										{/each}
									</div>
								</div>

								<div class="bg-white rounded-2xl shadow-xl border border-red-200 p-6">
									<h3 class="text-lg font-bold text-red-700 mb-4 flex items-center gap-2">
										<TrendingDownIcon class="w-5 h-5" />
										Top 5 questions échouées
									</h3>
									<div class="space-y-3">
										{#each liveSession.flopQuestions || [] as question, index (`flop-${index}`)}
											<div class="rounded-lg border border-red-100 p-3">
												<p class="text-sm font-medium text-[#122555] line-clamp-2">
													{question.question}
												</p>
												<p class="text-xs text-red-700 mt-1">
													{question.successRate}% réussite ({question.count} essais)
												</p>
											</div>
										{/each}
									</div>
								</div>
							</div>
						</div>
					{/if}
				{/if}
			</div>
		{/if}
	</div>
</div>
