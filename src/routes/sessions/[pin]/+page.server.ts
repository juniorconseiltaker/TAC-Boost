import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getTestSessionView, isAdmin } from '$lib/server/db';

export const load: PageServerLoad = async ({ params, locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id) {
		throw redirect(303, '/');
	}

	const pin = params.pin?.trim();
	if (!pin || !/^\d{6}$/.test(pin)) {
		throw redirect(303, '/sessions');
	}

	const testSession = getTestSessionView(pin, session.user.id);
	if (!testSession) {
		throw redirect(303, '/sessions');
	}

	return {
		session,
		isUserAdmin: isAdmin(session.user.email),
		testSession
	};
};
