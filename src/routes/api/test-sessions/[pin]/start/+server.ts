import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { startTestSession } from '$lib/server/db';

export const POST: RequestHandler = async ({ params, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id) {
		return json({ error: 'Authentication required' }, { status: 401 });
	}

	const pin = params.pin?.trim();
	if (!pin || !/^\d{6}$/.test(pin)) {
		return json({ error: 'Invalid PIN format' }, { status: 400 });
	}

	try {
		const started = startTestSession(pin, session.user.id);
		return json({ session: started });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to start session';
		const status = message === 'Session not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
