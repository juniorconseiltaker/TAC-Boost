import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getTestSessionView } from '$lib/server/db';

export const GET: RequestHandler = async ({ params, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const pin = params.pin?.trim();
	if (!pin || !/^\d{6}$/.test(pin)) {
		return json({ error: 'Invalid PIN format' }, { status: 400 });
	}

	const view = getTestSessionView(pin, session.user.id);
	if (!view) {
		return json({ error: 'Session not found or access denied' }, { status: 404 });
	}

	return json({ session: view });
};
