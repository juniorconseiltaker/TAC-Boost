<script lang="ts">
	import { goto } from '$app/navigation';
	import type { Session } from '@auth/core/types';
	import UserMenu from '$lib/components/UserMenu.svelte';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import PlusCircleIcon from '@lucide/svelte/icons/plus-circle';
	import BuildingIcon from '@lucide/svelte/icons/building-2';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { EXAM_MODES } from '$lib/types.js';

	let { data }: { data: { session: Session; isUserAdmin: boolean } } = $props();

	const PIN_LENGTH = 6;
	let pinDigits = $state<string[]>(Array(PIN_LENGTH).fill(''));
	let pinInputRefs: Array<HTMLInputElement | null> = [];
	let examModeToCreate = $state<'organisationnel' | 'tresorerie'>('organisationnel');
	let loadingJoin = $state(false);
	let loadingCreate = $state(false);
	let errorMessage = $state<string | null>(null);
	const modeRules = [
		{
			key: 'organisationnel' as const,
			name: EXAM_MODES.organisationnel.name,
			questionCount: EXAM_MODES.organisationnel.questionCount,
			timeLimit: EXAM_MODES.organisationnel.timeLimit,
			categories: EXAM_MODES.organisationnel.categories
		},
		{
			key: 'tresorerie' as const,
			name: EXAM_MODES.tresorerie.name,
			questionCount: EXAM_MODES.tresorerie.questionCount,
			timeLimit: EXAM_MODES.tresorerie.timeLimit,
			categories: EXAM_MODES.tresorerie.categories
		}
	];

	function focusPinInput(index: number) {
		const safeIndex = Math.max(0, Math.min(PIN_LENGTH - 1, index));
		pinInputRefs[safeIndex]?.focus();
		pinInputRefs[safeIndex]?.select();
	}

	function getCurrentPin() {
		return pinDigits.join('');
	}

	function handlePinInput(index: number, rawValue: string) {
		errorMessage = null;
		const digitsOnly = rawValue.replace(/\D/g, '');
		if (!digitsOnly) {
			pinDigits[index] = '';
			return;
		}

		const chars = digitsOnly.split('');
		chars.forEach((char, offset) => {
			if (index + offset < PIN_LENGTH) {
				pinDigits[index + offset] = char;
			}
		});

		if (chars.length > 1) {
			const nextIndex = Math.min(index + chars.length, PIN_LENGTH - 1);
			focusPinInput(nextIndex);
			return;
		}

		if (index < PIN_LENGTH - 1) {
			focusPinInput(index + 1);
		}
	}

	function handlePinKeydown(event: KeyboardEvent, index: number) {
		if (event.key === 'Backspace') {
			event.preventDefault();
			if (pinDigits[index]) {
				pinDigits[index] = '';
				return;
			}
			if (index > 0) {
				pinDigits[index - 1] = '';
				focusPinInput(index - 1);
			}
			return;
		}

		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			focusPinInput(index - 1);
			return;
		}

		if (event.key === 'ArrowRight') {
			event.preventDefault();
			focusPinInput(index + 1);
			return;
		}

		if (event.key.length === 1 && /\D/.test(event.key)) {
			event.preventDefault();
		}
	}

	function handlePinPaste(event: ClipboardEvent, index: number) {
		event.preventDefault();
		const pasted = event.clipboardData?.getData('text') ?? '';
		handlePinInput(index, pasted);
	}

	async function joinSession() {
		const pin = getCurrentPin().trim();
		if (!/^\d{6}$/.test(pin)) {
			errorMessage = 'Le code PIN doit contenir 6 chiffres.';
			return;
		}

		loadingJoin = true;
		errorMessage = null;
		try {
			const response = await fetch('/api/test-sessions/join', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ pin })
			});
			const data = await response.json();
			if (!response.ok) {
				errorMessage = data.error || 'Impossible de rejoindre la session.';
				return;
			}
			await goto(`/sessions/${pin}`);
		} catch {
			errorMessage = 'Une erreur réseau est survenue.';
		} finally {
			loadingJoin = false;
		}
	}

	async function createSession() {
		loadingCreate = true;
		errorMessage = null;
		try {
			const response = await fetch('/api/test-sessions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ examMode: examModeToCreate })
			});
			const payload = await response.json();
			if (!response.ok) {
				errorMessage = payload.details
					? `${payload.error || 'Impossible de créer la session.'} (${payload.details})`
					: (payload.error ?? 'Impossible de créer la session.');
				return;
			}
			await goto(`/sessions/${payload.session.pin}`);
		} catch {
			errorMessage = 'Une erreur réseau est survenue.';
		} finally {
			loadingCreate = false;
		}
	}
</script>

<div class="min-h-screen bg-gradient-to-br from-white via-slate-50 to-[#122555]/5">
	<div class="container mx-auto px-4 py-8">
		<header class="flex justify-between items-center mb-8">
			<div>
				<a href="/" class="text-[#122555] hover:text-[#122555]/70 flex items-center gap-2 mb-3">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
					Retour
				</a>
				<h1 class="text-4xl font-bold text-[#122555] mb-2 flex items-center gap-3">
					<UsersIcon class="w-8 h-8" />
					Sessions de test
				</h1>
				<p class="text-[#122555]/60">Rejoignez une session avec un PIN.</p>
			</div>
			<UserMenu session={data.session} isAdmin={data.isUserAdmin} />
		</header>

		{#if errorMessage}
			<div class="max-w-4xl mx-auto mb-6">
				<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
					{errorMessage}
				</div>
			</div>
		{/if}

		<div
			class="mx-auto grid grid-cols-1 gap-6 {data.isUserAdmin
				? 'max-w-4xl md:grid-cols-2'
				: 'max-w-2xl'}"
		>
			<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
				<h2 class="text-xl font-bold text-[#122555] mb-2 flex items-center gap-2">
					<KeyRoundIcon class="w-5 h-5" />
					Rejoindre une session
				</h2>
				<p class="text-[#122555]/60 mb-5">Saisissez le code PIN transmis par l'admin.</p>

				<form
					class="space-y-4"
					novalidate
					onsubmit={(event) => {
						event.preventDefault();
						joinSession();
					}}
				>
					<div class="flex items-center justify-between gap-2 sm:gap-3">
						{#each pinDigits as digit, index (index)}
							<input
								type="text"
								inputmode="numeric"
								maxlength={1}
								autocomplete={index === 0 ? 'one-time-code' : 'off'}
								value={digit}
								bind:this={pinInputRefs[index]}
								oninput={(event) =>
									handlePinInput(index, (event.currentTarget as HTMLInputElement).value)}
								onkeydown={(event) => handlePinKeydown(event, index)}
								onpaste={(event) => handlePinPaste(event, index)}
								class="h-14 w-full rounded-xl border border-[#122555]/20 text-center text-2xl font-mono font-semibold text-[#122555] focus:outline-none focus:ring-2 focus:ring-[#122555]/30"
								aria-label={`Chiffre ${index + 1} du code PIN`}
							/>
						{/each}
					</div>
					<button
						type="submit"
						disabled={loadingJoin}
						class="w-full rounded-xl bg-[#122555] hover:bg-[#0d1a3d] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors"
					>
						{loadingJoin ? 'Connexion...' : 'Rejoindre'}
					</button>
				</form>
			</div>

			{#if data.isUserAdmin}
				<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6">
					<h2 class="text-xl font-bold text-[#122555] mb-2 flex items-center gap-2">
						<PlusCircleIcon class="w-5 h-5" />
						Créer une session
					</h2>
					<p class="text-[#122555]/60 mb-5">Choisissez un mode puis créez la session.</p>

					<div class="space-y-3 mb-5">
						<button
							type="button"
							onclick={() => (examModeToCreate = 'organisationnel')}
							class="w-full p-4 rounded-xl border-2 text-left transition-colors {examModeToCreate ===
							'organisationnel'
								? 'border-[#122555] bg-[#122555]/5'
								: 'border-[#122555]/20 hover:bg-[#122555]/5'}"
						>
							<div class="flex items-center gap-3">
								<BuildingIcon class="w-5 h-5 text-[#122555]" />
								<div>
									<p class="font-semibold text-[#122555]">TAC1 Organisationnel</p>
									<p class="text-sm text-[#122555]/60">50 questions • 30 min</p>
								</div>
							</div>
						</button>
						<button
							type="button"
							onclick={() => (examModeToCreate = 'tresorerie')}
							class="w-full p-4 rounded-xl border-2 text-left transition-colors {examModeToCreate ===
							'tresorerie'
								? 'border-[#122555] bg-[#122555]/5'
								: 'border-[#122555]/20 hover:bg-[#122555]/5'}"
						>
							<div class="flex items-center gap-3">
								<WalletIcon class="w-5 h-5 text-[#122555]" />
								<div>
									<p class="font-semibold text-[#122555]">TAC1 Trésorerie</p>
									<p class="text-sm text-[#122555]/60">50 questions • 30 min</p>
								</div>
							</div>
						</button>
					</div>

					<button
						type="button"
						onclick={createSession}
						disabled={loadingCreate}
						class="w-full rounded-xl bg-[#122555] hover:bg-[#0d1a3d] disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 transition-colors"
					>
						{loadingCreate ? 'Création...' : 'Créer la session'}
					</button>
				</div>
			{/if}
		</div>

		<div class="max-w-4xl mx-auto mt-8">
			<div class="bg-white rounded-2xl shadow-xl border border-[#122555]/10 p-6 md:p-8">
				<h2 class="text-2xl font-bold text-[#122555] mb-2">Règles des sessions de test</h2>
				<p class="text-[#122555]/65 mb-6">
					Les sessions sont des entraînements supervisés par un admin. Elles ne modifient pas le
					classement général.
				</p>

				<div
					class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800 text-sm mb-6"
				>
					Les scores obtenus en session de test ne sont jamais enregistrés dans le classement orga /
					tréso.
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each modeRules as mode (mode.key)}
						<div class="rounded-xl border border-[#122555]/15 bg-[#122555]/[0.02] p-4">
							<p class="font-semibold text-[#122555] mb-3">{mode.name}</p>
							<div class="grid grid-cols-2 gap-3 mb-4">
								<div class="rounded-lg bg-white border border-[#122555]/10 px-3 py-2">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Durée</p>
									<p class="text-sm font-semibold text-[#122555]">{mode.timeLimit} min</p>
								</div>
								<div class="rounded-lg bg-white border border-[#122555]/10 px-3 py-2">
									<p class="text-xs uppercase tracking-wide text-[#122555]/60">Questions</p>
									<p class="text-sm font-semibold text-[#122555]">{mode.questionCount}</p>
								</div>
							</div>
							<div>
								<p class="text-xs uppercase tracking-wide text-[#122555]/60 mb-2">
									Catégories abordées
								</p>
								<div class="flex flex-wrap gap-2">
									{#each mode.categories as category (category)}
										<span
											class="px-2.5 py-1 rounded-full text-xs font-medium bg-[#122555]/10 text-[#122555]"
										>
											{category}
										</span>
									{/each}
								</div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
