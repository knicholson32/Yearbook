import { redirect } from '@sveltejs/kit';

export const load = async ({ locals, url }) => {
  const { user, email } = locals;

  if (!url.pathname.startsWith('/new-user') && user === null) redirect(307, '/new-user');

  return {
    user,
    email
  };
};
