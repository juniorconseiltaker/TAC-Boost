import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { updateTestSessionParticipantProgress } from '$lib/server/db';

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
	const currentQuestion = Number(body?.currentQuestion);
	if (!Number.isFinite(currentQuestion)) {
		return json({ error: 'Invalid currentQuestion' }, { status: 400 });
	}

	try {
		const progress = updateTestSessionParticipantProgress({
			pin,
			userId: session.user.id,
			currentQuestion
		});
		return json({ success: true, progress });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update progress';
		const status = message === 'Session not found' ? 404 : 400;
		return json({ error: message }, { status });
	}
};
