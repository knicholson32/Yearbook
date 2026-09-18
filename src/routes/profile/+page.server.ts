import { prisma } from '$lib/server/db';
import { fail } from '@sveltejs/kit';
import { cropImages, deleteImages, getImageFolder } from '$lib/server/image';
import { setPersonProfileImage } from '$lib/server/image/profile';
import { detectFormat } from '$lib/server/image/format';
import fs from 'node:fs';
import * as settings from '$lib/server/settings';
import { isAdmin, requireAdmin } from '$lib/server/auth';

export const load = async ({ locals }) => {
  const familiesRaw = await prisma.family.findMany({ include: { people: true } });
  const families = familiesRaw.map((f) => ({
    value: f.id,
    label: f.people.map((p) => p.name.split(' ')[0]).join(', ') || 'Unnamed group'
  }));

  // Everyone in the signed-in user's group, so they can be managed from here.
  const groupId = locals.user?.person.familyId ?? null;
  const group = groupId === null
    ? []
    : (
        await prisma.person.findMany({
          where: { familyId: groupId },
          orderBy: { name: 'asc' },
          include: {
            user: { select: { id: true } },
            profileImage: {
              select: {
                cropX: true,
                cropY: true,
                cropWidth: true,
                cropHeight: true,
                updatedAt: true
              }
            },
            // Shown when confirming a removal, so the consequence is visible up front.
            _count: { select: { appearsIn: true } }
          }
        })
      ).map((p) => ({
        id: p.id,
        name: p.name,
        imageId: p.imageId,
        // Changes when the picture is rebuilt, which is what makes a reframed avatar
        // actually refresh instead of coming back out of the browser cache.
        imageVersion: p.profileImage?.updatedAt.getTime() ?? null,
        // Sent back so reopening the cropper starts from the framing already in use.
        crop:
          p.profileImage?.cropWidth != null && p.profileImage?.cropHeight != null
            ? {
                x: p.profileImage.cropX ?? 0,
                y: p.profileImage.cropY ?? 0,
                width: p.profileImage.cropWidth,
                height: p.profileImage.cropHeight
              }
            : null,
        taggedIn: p._count.appearsIn,
        /** People with an account sign in themselves; the rest are managed here. */
        accountEmail: p.user?.id ?? null,
        isSelf: p.id === locals.user?.personId
      }));

  const monthColumns = await settings.get('upload.monthColumns');
  const yearsBackground = await settings.get('years.background');
  const familyName = await settings.get('general.familyName');

  // Only admins are shown the administrators panel, so only they need the list. Small by
  // nature -- one row per person with an account -- so there is nothing to paginate.
  const accounts = !isAdmin(locals.user)
    ? []
    : (
        await prisma.user.findMany({
          select: {
            id: true,
            role: true,
            gravatarHash: true,
            person: {
              select: { name: true, profileImage: { select: { id: true, updatedAt: true } } }
            }
          },
          orderBy: { person: { name: 'asc' } }
        })
      ).map((a) => ({
        email: a.id,
        name: a.person.name,
        isAdmin: a.role === 'admin',
        isSelf: a.id === locals.user?.id,
        gravatarHash: a.gravatarHash,
        imageId: a.person.profileImage?.id ?? null,
        // Busts the browser cache when a picture is recropped.
        version: a.person.profileImage?.updatedAt.getTime() ?? null
      }));

  return {
    accounts,
    families,
    group,
    monthColumns,
    monthColumnsMax: settings.MONTH_COLUMNS_MAX,
    yearsBackground,
    yearsBackgrounds: settings.YEARS_BACKGROUNDS,
    familyName,
    isAdmin: isAdmin(locals.user)
  };
};

/** Everyone in a group may manage that group's people. */
const inGroup = async (locals: App.Locals, personId: string) => {
  if (locals.user === null) return fail(401, { message: 'Not signed in' });
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { familyId: true, user: { select: { id: true } } }
  });
  if (person === null) return fail(404, { message: 'Person not found' });
  if (locals.user.role !== 'admin' && person.familyId !== locals.user.person.familyId) {
    return fail(403, { message: 'That person is in another group' });
  }
  return null;
};

export const actions = {
  // Site-wide rather than per-person: the Settings table is keyed by name alone, with no user
  // column. Everyone in the household sees the same grid.
  setMonthColumns: async ({ request, locals }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const columns = Number(data.get('columns'));
    if (!Number.isInteger(columns)) return fail(400, { message: 'Pick a whole number of columns' });
    if (columns < settings.MONTH_COLUMNS_MIN || columns > settings.MONTH_COLUMNS_MAX)
      return fail(400, {
        message: `Columns must be between ${settings.MONTH_COLUMNS_MIN} and ${settings.MONTH_COLUMNS_MAX}`
      });

    await settings.set('upload.monthColumns', columns);
    return { message: 'Saved' };
  },

  /**
   * The name for the whole collection. Admins only.
   *
   * Unlike the other settings on this page, this one names the household rather than
   * adjusting a view, so it is not something any signed-in member should be able to rewrite.
   */
  /**
   * Grant or revoke the admin dashboard.
   *
   * Administrators live in `User.role`, not in the environment, so this is the only way one
   * is made after the first account on a fresh install. Demoting is allowed -- including
   * yourself, which is how you hand the job over -- except for the last one: a database with
   * no administrator can only be repaired by hand, and nothing in the app can put one back.
   */
  setAdmin: async ({ request, locals }) => {
    requireAdmin(locals.user);
    const data = await request.formData();

    const email = data.get('email')?.toString() ?? '';
    const makeAdmin = data.get('admin') === 'true';
    if (email === '') return fail(400, { message: 'Which account?' });

    const target = await prisma.user.findUnique({ where: { id: email }, select: { role: true } });
    if (target === null) return fail(404, { message: 'No such account' });

    if (!makeAdmin && target.role === 'admin') {
      const admins = await prisma.user.count({ where: { role: 'admin' } });
      if (admins <= 1) return fail(409, { message: 'Someone has to stay an administrator' });
    }

    await prisma.user.update({
      where: { id: email },
      data: { role: makeAdmin ? 'admin' : 'user' }
    });

    return {
      message: makeAdmin
        ? `${email} is now an administrator`
        : `${email} is no longer an administrator`
    };
  },

  setFamilyName: async ({ request, locals }) => {
    const data = await request.formData();
    requireAdmin(locals.user);

    const name = data.get('familyName')?.toString().trim() ?? '';
    if (name.length > 80) return fail(400, { message: 'That name is too long' });

    await settings.set('general.familyName', name);
    return { message: 'Saved' };
  },

  /** Which treatment the Years shelf gets behind it. Site-wide, like the column count. */
  setYearsBackground: async ({ request, locals }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const value = data.get('background')?.toString() ?? '';
    if (!settings.YEARS_BACKGROUNDS.includes(value as settings.YearsBackground)) {
      return fail(400, { message: 'Unknown background' });
    }

    await settings.set('years.background', value as settings.YearsBackground);
    return { message: 'Saved' };
  },

  /**
   * Update the signed-in user's own name and group. Named rather than default: SvelteKit
   * refuses to mix a default action with named ones.
   */
  updateProfile: async ({ request, locals }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const name = data.get('name')?.toString();
    const group = data.get('group')?.toString();
    const person = data.get('person')?.toString();

    if (group === undefined || group === '') return fail(400, { message: 'Group Required' });
    if (name === undefined || name === '') return fail(400, { message: 'Name Required' });
    if (person === undefined || person === '') return fail(400, { message: 'Person Required' });

    const denied = await inGroup(locals, person);
    if (denied !== null) return denied;

    const family = await prisma.family.findUnique({ where: { id: group } });
    if (family === null) return fail(400, { message: 'Unknown Group.' });

    try {
      await prisma.person.update({ where: { id: person }, data: { name, familyId: family.id } });
    } catch (e) {
      console.log('Error updating person', e);
      return fail(400, { message: 'Could not save. That name may already be taken.' });
    }
    return { success: true };
  },

  /** Set or replace any group member's picture, including your own. */
  setPhoto: async ({ request, locals }) => {
    // Read the upload before deciding anything. Returning early leaves the browser still
    // sending a multi-megabyte body: the server answers and hangs up mid-stream, the
    // socket dies, and Node reports it as `Error: aborted` on a 500.
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const personId = data.get('person')?.toString();
    const image = data.get('image');

    if (personId === undefined || personId === '') return fail(400, { message: 'Person required' });
    if (!(image instanceof File) || image.size === 0) return fail(400, { message: 'Pick an image first' });

    const denied = await inGroup(locals, personId);
    if (denied !== null) return denied;

    const result = await setPersonProfileImage(personId, image, locals.user.id);
    if (!result.ok) return fail(400, { message: result.message });
    return { success: true };
  },

  /**
   * Reframe an existing profile picture.
   *
   * The stored original is never touched, so this rebuilds every derivative from it with
   * the new region applied -- which means a crop can be redone or widened later without
   * any loss, and works for HEIC originals the browser could not have cropped itself.
   */
  cropPhoto: async ({ request, locals }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const personId = data.get('person')?.toString();
    if (personId === undefined || personId === '') return fail(400, { message: 'Person required' });

    const denied = await inGroup(locals, personId);
    if (denied !== null) return denied;

    const rect = {
      x: Number(data.get('x')),
      y: Number(data.get('y')),
      width: Number(data.get('width')),
      height: Number(data.get('height'))
    };

    const sane =
      Object.values(rect).every((v) => Number.isFinite(v)) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.width <= 1.0001 &&
      rect.y + rect.height <= 1.0001;
    if (!sane) return fail(400, { message: 'That crop does not fit the picture' });

    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { profileImage: { select: { id: true, original: true } } }
    });
    const image = person?.profileImage;
    if (image === null || image === undefined) return fail(400, { message: 'No picture to crop' });

    const originalPath = `${getImageFolder()}/${image.original}`;
    if (!fs.existsSync(originalPath)) return fail(400, { message: 'Original is missing on disk' });

    try {
      const raw = fs.readFileSync(originalPath);
      const rebuilt = await cropImages(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
        detectFormat(raw),
        image.id,
        rect
      );
      if (rebuilt === null) return fail(500, { message: 'Could not rebuild that picture' });

      await prisma.image.update({
        where: { id: image.id },
        data: {
          full: rebuilt.full,
          i2048: rebuilt.i2048,
          i1024: rebuilt.i1024,
          i768: rebuilt.i768,
          i512: rebuilt.i512,
          i256: rebuilt.i256,
          i128: rebuilt.i128,
          cropX: rect.x,
          cropY: rect.y,
          cropWidth: rect.width,
          cropHeight: rect.height
        }
      });
    } catch (e) {
      console.log('Error cropping profile picture', e);
      return fail(500, { message: 'Could not crop that picture. See logs.' });
    }

    return { success: true };
  },

  /** Add someone to the group who does not have an account -- a child, say. */
  addPerson: async ({ request, locals }) => {
    // Drained before authorising, for the same reason as setPhoto above.
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const name = data.get('name')?.toString().trim();
    if (name === undefined || name === '') return fail(400, { message: 'Name required' });

    try {
      const person = await prisma.person.create({
        data: { name, familyId: locals.user.person.familyId }
      });

      const image = data.get('image');
      if (image instanceof File && image.size > 0) {
        await setPersonProfileImage(person.id, image, locals.user.id);
      }
    } catch (e) {
      // Person.name is unique across the whole database, so any duplicate lands here.
      console.log('Error adding person', e);
      return fail(400, { message: `Could not add "${name}". That name may already exist.` });
    }
    return { success: true };
  },

  /**
   * Remove someone from the group. Only people without an account: anyone who signs in
   * owns their own record, and deleting it would break their session.
   */
  removePerson: async ({ request, locals }) => {
    const data = await request.formData();
    if (locals.user === null) return fail(401, { message: 'Not signed in' });

    const personId = data.get('person')?.toString();
    if (personId === undefined || personId === '') return fail(400, { message: 'Person required' });

    const denied = await inGroup(locals, personId);
    if (denied !== null) return denied;

    const person = await prisma.person.findUnique({
      where: { id: personId },
      select: { imageId: true, user: { select: { id: true } } }
    });
    if (person === null) return fail(404, { message: 'Person not found' });
    if (person.user !== null) {
      return fail(400, { message: 'That person has an account and cannot be removed here' });
    }

    try {
      // Photo tags referencing them go too; the photos themselves are untouched.
      await prisma.person.delete({ where: { id: personId } });
      if (person.imageId !== null) await deleteImages(person.imageId);
    } catch (e) {
      console.log('Error removing person', e);
      return fail(500, { message: 'Could not remove that person. See logs.' });
    }
    return { success: true };
  }
};
