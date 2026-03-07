import type { PageServerLoad } from './$types';
import { getTestSessionAdminDetails, getTestSessionHistory } from '$lib/server/db';

export const load: PageServerLoad = async ({ url }) => {
	const history = getTestSessionHistory(200);

	const sessionIdParam = url.searchParams.get('session');
	const parsedSessionId = sessionIdParam ? Number.parseInt(sessionIdParam, 10) : NaN;
	const selectedSessionId = Number.isFinite(parsedSessionId)
		? parsedSessionId
		: (history[0]?.id ?? null);

	const selectedSession = selectedSessionId ? getTestSessionAdminDetails(selectedSessionId) : null;

	return {
		history,
		selectedSessionId,
		selectedSession
	};
};
