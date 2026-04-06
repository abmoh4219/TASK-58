import { redirect } from '@sveltejs/kit';

import { fetchAuthSession } from '$lib/server/auth';
import { getFrontendConfig } from '$lib/server/config';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const session = await fetchAuthSession(event);
  if (session) {
    throw redirect(302, '/');
  }

  const config = getFrontendConfig();

  return {
    publicApiBaseUrl: config.publicApiBaseUrl
  };
};
