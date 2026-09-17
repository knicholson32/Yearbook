import { requireAdmin } from '$lib/server/auth';
import { prisma } from '$lib/server/db';

/**
 * A bench for checking how iOS renders an HDR photograph under different CSS.
 *
 * Safari only grants a photograph extended dynamic range in some compositing situations, and
 * there is no way to ask a page whether it got it -- the difference is visible on the display
 * and nowhere in the DOM. So this renders one photograph many times, each under a single
 * named condition, and leaves the judgement to a person looking at the screen.
 */
export const load = async ({ locals }) => {
  requireAdmin(locals.user);

  const hdr = await prisma.image.findMany({
    where: { isHDR: true },
    orderBy: { updatedAt: 'desc' },
    take: 8,
    select: { id: true, width: true, height: true, caption: true, hex: true }
  });

  const sdr = await prisma.image.findFirst({
    where: { isHDR: false },
    select: { id: true, width: true, height: true, hex: true }
  });

  return { hdr, sdr };
};
