import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { createTestSession, getOrCreateUser, isAdmin } from '$lib/server/db';

export const GET: RequestHandler = async () => {
	return json(
		{
			error: 'GET not supported on this endpoint. Use POST to create a test session.'
		},
		{ status: 405 }
	);
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id || !session.user.email) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	if (!isAdmin(session.user.email)) {
		return json({ error: 'Admin access required' }, { status: 403 });
	}

	const body = await request.json();
	const examMode = body?.examMode;

	const VALID_MODES = ['organisationnel', 'tresorerie', 'custom'];
	if (!VALID_MODES.includes(examMode)) {
		return json({ error: 'Invalid exam mode' }, { status: 400 });
	}

	if (examMode === 'custom') {
		const categories: unknown = body?.categories;
		if (
			!Array.isArray(categories) ||
			categories.length === 0 ||
			!categories.every((c) => typeof c === 'string')
		) {
			return json(
				{ error: 'Custom mode requires at least one category in "categories"' },
				{ status: 400 }
			);
		}
		const questionCount = body?.questionCount;
		if (questionCount !== undefined && (typeof questionCount !== 'number' || questionCount < 1)) {
			return json({ error: 'Invalid questionCount' }, { status: 400 });
		}
		const timeLimit = body?.timeLimitMinutes;
		if (timeLimit !== undefined && (typeof timeLimit !== 'number' || timeLimit < 1)) {
			return json({ error: 'Invalid timeLimitMinutes' }, { status: 400 });
		}
	}

	try {
		getOrCreateUser({
			id: session.user.id,
			email: session.user.email,
			name: session.user.name || 'Unknown',
			image: session.user.image || null
		});

		const created = createTestSession({
			createdByUserId: session.user.id,
			examMode,
			...(examMode === 'custom' && {
				customCategories: body.categories as string[],
				customQuestionCount: body.questionCount as number | undefined,
				customTimeLimitMinutes: body.timeLimitMinutes as number | undefined
			})
		});

		return json({ session: created });
	} catch (error) {
		console.error('Error creating test session:', error);
		const details = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: 'Failed to create session', details }, { status: 500 });
	}
};
