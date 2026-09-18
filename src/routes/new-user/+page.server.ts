import { prisma } from '$lib/server/db';
import { redirect } from '@sveltejs/kit';
import { gravatarHash, setGravatarProfileImage, setPersonProfileImage } from '$lib/server/image/profile';

export const load = async ({ parent, url, fetch, request }) => {
  const parentData = await parent();
  const email = parentData.email;

  const user = await prisma.user.findUnique({ where: { id: email ?? '' } });

  if (user !== null) redirect(303, '/');

  const hash = gravatarHash(email);

  const familiesRaw = await prisma.family.findMany({ include: { people: true } });
  const persons = (await prisma.person.findMany({ include: { user: true } })).filter((p) => p.user === null);

  const families = familiesRaw.flatMap((f) => { return { value: f.id, label: (f.people.map((p) => p.name.split(' ')[0])).join(', ') } });

  families.push({ value: 'new', label: 'New Group' });

  return {
    hash,
    families,
    persons
  };

};


export const actions = {
  create: async ({ request, locals }) => {

    const data = await request.formData();
    
    const image = data.get('image');
    // `locals.email` comes from the verified Access token; the raw header is caller-supplied
    // and would let anyone create an account in someone else's name.
    const email = locals.email;
    const name = data.get('name')?.toString();
    const group = data.get('group')?.toString();


    const hash = gravatarHash(email);


    if (group === undefined || group === '') return { error: 'Group Required'};
    if (name === undefined || name === '') return { error: 'Name Required'};
    if (email === null || email === '') return { error: 'Name Required'};

    // The Name field offers everyone who has been tagged in a photo but has never signed in
    // (see `persons` in `load`), so choosing one of those names means "that person is me",
    // not "make a second person with the same name" -- and `Person.name` is unique, so
    // creating one would fail outright. Claim the existing row instead.
    const claimed = await prisma.person.findUnique({
      where: { name },
      include: { user: true, profileImage: true }
    });

    if (claimed?.user != null) {
      return { error: `${name} already has an account. Sign in as ${claimed.user.id} instead.` };
    }

    if (group !== 'new' && (await prisma.family.findUnique({ where: { id: group } })) === null) {
      return { error: 'Unknown Group.' };
    }

    let personId: string;

    try {
      // One transaction so a half-made account cannot survive a failure part-way through:
      // without it, a failed `user.create` would leave the new person -- and a brand new
      // group -- stranded with nothing pointing at them.
      personId = await prisma.$transaction(async (tx) => {
        const familyId = group === 'new' ? (await tx.family.create({ data: {} })).id : group;

        // Whoever tagged them first had to guess a group; the person signing up knows their
        // own, so the choice made on this form wins.
        const person = claimed === null
          ? await tx.person.create({ data: { name, familyId } })
          : await tx.person.update({ where: { id: claimed.id }, data: { familyId } });

        // Whoever signs up while the database has no administrator is standing the server
        // up, so they get the dashboard and can promote everyone after them. Checked inside
        // the transaction so two simultaneous first signups cannot both come out as admin.
        const role = (await tx.user.count({ where: { role: 'admin' } })) === 0 ? 'admin' : 'user';

        await tx.user.create({
          data: { id: email, personId: person.id, gravatarHash: hash, role }
        });

        return person.id;
      });
    } catch (e) {
      // Whatever Prisma throws is an Error, and SvelteKit can only put a POJO in `form` --
      // returning the object itself made the page crash on "Cannot stringify arbitrary
      // non-POJOs" and buried the real reason. Log the original, hand back a string.
      console.error('Could not create the account for', email, e);
      const code = typeof e === 'object' && e !== null && 'code' in e ? (e as { code: unknown }).code : null;
      return {
        error: code === 'P2002'
          ? 'That name is already taken. Pick a different one.'
          : e instanceof Error
            ? e.message
            : 'Something went wrong creating your account.'
      };
    }

    // Outside the transaction: this encodes and writes an image file, which has nothing to
    // do with the rows above and should not hold a database lock while it runs.
    //
    // Keep whatever they chose; otherwise fall back to the Gravatar they were shown, so
    // nobody ends up without a picture. Either way it becomes a normal stored image, so
    // the rest of the app never has to special-case where an avatar came from. A claimed
    // person who already had a picture keeps it unless they uploaded a replacement.
    const result = image instanceof File && image.size > 0
      ? await setPersonProfileImage(personId, image, email)
      : claimed?.profileImage != null
        ? { ok: true as const, message: 'kept the existing picture' }
        : await setGravatarProfileImage(personId, email, email);

    if (!result.ok) console.log('Could not store profile image for', email, result.message);

    redirect(303, '/');


  }

}