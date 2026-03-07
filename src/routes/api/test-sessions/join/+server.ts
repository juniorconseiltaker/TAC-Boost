import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getOrCreateUser, joinTestSession } from '$lib/server/db';

export const POST: RequestHandler = async ({ request, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id || !session.user.email) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const body = await request.json();
	const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';

	if (!/^\d{6}$/.test(pin)) {
		return json({ error: 'Invalid PIN format' }, { status: 400 });
	}

	try {
		getOrCreateUser({
			id: session.user.id,
			email: session.user.email,
			name: session.user.name || 'Unknown',
			image: session.user.image || null
		});

		const joined = joinTestSession(pin, session.user.id);
		return json({ session: joined });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to join session';
		const status = message === 'Session not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
