import { redirect } from '@sveltejs/kit';
import { isAdmin } from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const session = await locals.auth();

	if (!session?.user?.id) {
		throw redirect(303, '/');
	}

	return {
		session,
		isUserAdmin: isAdmin(session.user.email)
	};
};
