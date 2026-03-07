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

	if (examMode !== 'organisationnel' && examMode !== 'tresorerie') {
		return json({ error: 'Invalid exam mode' }, { status: 400 });
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
			examMode
		});

		return json({ session: created });
	} catch (error) {
		console.error('Error creating test session:', error);
		const details = error instanceof Error ? error.message : 'Unknown error';
		return json({ error: 'Failed to create session', details }, { status: 500 });
	}
};
