import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getUserStats, getUserById } from '$lib/server/db';

export const load: PageServerLoad = async ({ params }) => {
	const userId = params.id;

	const user = getUserById(userId);
	if (!user) {
		throw error(404, 'Utilisateur non trouvé');
	}

	const stats = getUserStats(userId);

	return {
		viewedUser: user,
		stats
	};
};
