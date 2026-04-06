import { redirect } from '@sveltejs/kit';

import { fetchAuthSession } from '$lib/server/auth';
import { getFrontendConfig } from '$lib/server/config';

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
  const session = await fetchAuthSession(event);

  if (!session) {
    throw redirect(302, '/sign-in');
  }

  const config = getFrontendConfig();

  return {
    session,
    publicApiBaseUrl: config.publicApiBaseUrl
  };
};
