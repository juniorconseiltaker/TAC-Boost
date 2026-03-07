import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { submitTestSessionResult } from '$lib/server/db';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const pin = params.pin?.trim();
	if (!pin || !/^\d{6}$/.test(pin)) {
		return json({ error: 'Invalid PIN format' }, { status: 400 });
	}

	const body = await request.json();
	const {
		score,
		totalQuestions,
		correctAnswers,
		timeSpent,
		categoryScores = {},
		questionResults = []
	} = body || {};

	if (typeof score !== 'number' || score < 0 || score > 100) {
		return json({ error: 'Invalid score' }, { status: 400 });
	}
	if (typeof totalQuestions !== 'number' || totalQuestions <= 0) {
		return json({ error: 'Invalid totalQuestions' }, { status: 400 });
	}
	if (typeof correctAnswers !== 'number' || correctAnswers < 0 || correctAnswers > totalQuestions) {
		return json({ error: 'Invalid correctAnswers' }, { status: 400 });
	}
	if (typeof timeSpent !== 'number' || timeSpent < 0) {
		return json({ error: 'Invalid timeSpent' }, { status: 400 });
	}
	if (!Array.isArray(questionResults)) {
		return json({ error: 'Invalid questionResults' }, { status: 400 });
	}

	try {
		const submission = submitTestSessionResult({
			pin,
			userId: session.user.id,
			score,
			totalQuestions,
			correctAnswers,
			timeSpent,
			categoryScores,
			questionResults
		});

		return json({ success: true, submission });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to submit result';
		const status = message === 'Session not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
