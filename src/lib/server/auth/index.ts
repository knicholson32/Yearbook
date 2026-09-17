import jwt from 'jsonwebtoken';
import type { JwtHeader, SigningKeyCallback, JwtPayload, VerifyOptions } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { prisma } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

// 1. Configure configuration variables
const TEAM_DOMAIN = 'https://eroute.cloudflareaccess.com';
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const APPLICATION_AUDIENCE = '0efa1a512f491d5d3a16e844c6428cd336ff5639516f2c0c71b73f346a024d4c';

// 2. Initialize the JWKS client to pull public certificates dynamically
const client = jwksClient({
  jwksUri: CERTS_URL,
  cache: true,
  rateLimit: true,
  jwksRequestsPerMinute: 5
});

// Helper function to fetch the correct public key based on the JWT header's 'kid'
const getKey = (header: JwtHeader, callback: SigningKeyCallback): void => {
  if (!header.kid) {
    return callback(new Error('Missing "kid" parameter in JWT header'));
  }

  client.getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      return callback(err || new Error('Could not find matching signing key'));
    }
    const signingKey = key.getPublicKey() || ('rsaPublicKey' in key ? (key as any).rsaPublicKey : '');
    callback(null, signingKey);
  });
}

/**
 * Validates the Cloudflare Access JWT
 * @param token - The raw token from 'Cf-Access-Jwt-Assertion' header
 * @returns Resolves with the decoded JWT Payload if valid
 */
export const validateCloudflareJWT = (token: string): Promise<JwtPayload> => {
  return new Promise((resolve, reject) => {
    if (!token) {
      return reject(new Error('Missing token'));
    }

    const options: VerifyOptions = {
      audience: APPLICATION_AUDIENCE, // Verifies 'aud' claim
      issuer: TEAM_DOMAIN,           // Verifies 'iss' claim
      algorithms: ['RS256']          // Cloudflare Access uses RS256
    };

    jwt.verify(token, getKey, options, (err, decoded) => {
      if (err || !decoded) {
        return reject(new Error(`JWT validation failed: ${err?.message || 'Unknown error'}`));
      }

      // If verification passes, it returns the decoded object
      resolve(decoded as JwtPayload);
    });
  });
}

/**
 * Emails promoted to admin, from `ADMIN_EMAILS` (comma separated).
 *
 * `User.role` has always existed but nothing ever wrote 'admin' to it, so the admin paths
 * were unreachable. Granting it from the environment rather than the database keeps it out
 * of the app's own UI: an admin cannot be created by anyone who is merely signed in, and
 * revoking one is a restart rather than a migration.
 */
const adminEmails = (): string[] =>
	(env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry.length > 0);

export const isAdminEmail = (email: string | null | undefined): boolean =>
	typeof email === 'string' && adminEmails().includes(email.toLowerCase());

export type SessionUser = NonNullable<Awaited<ReturnType<typeof lookupUser>>>;

const lookupUser = async (email: string) => {
  const user = await prisma.user.findUnique({
    where: { id: email },
    include: {
      person: {
        include: {
          family: true,
          // Carried so the header avatar can bust its cache when the picture is rebuilt.
          profileImage: { select: { updatedAt: true } }
        }
      }
    }
  });

  if (user === null) return null;

  // Applied to the session rather than written back, so the environment stays the single
  // source of truth and removing an address demotes on the next request.
  return isAdminEmail(email) ? { ...user, role: 'admin' } : user;
};

/**
 * Resolve the signed-in user from the Cloudflare Access headers on a request.
 *
 * NOTE: JWT validation failures are logged but not enforced, matching the behaviour this
 * had while it lived in `+layout.server.ts`. Until the `error(403)` below is uncommented,
 * the `cf-access-authenticated-user-email` header is trusted on its own -- which is fine
 * behind the tunnel, where Cloudflare Access sets it, but means anything that can reach
 * the origin directly can spoof a user.
 */
export const getSession = async (request: Request) => {
  const email = request.headers.get('cf-access-authenticated-user-email');
  const token = request.headers.get('cf-access-jwt-assertion');

  if (!token || typeof token !== 'string') {
    // error(403, 'Access denied');
  }

  try {
    await validateCloudflareJWT(token ?? '');
  } catch (e: any) {
    console.error('JWT validation failed:', e);
    // error(403, 'Access denied');
  }

  return {
    email,
    user: email === null ? null : await lookupUser(email)
  };
};

/**
 * Whether `user` may edit or delete a photo.
 *
 * Scoped to the family, not the individual: a yearbook is a shared album, so anyone in the
 * group can tidy up anyone else's uploads. Admins reach everything.
 *
 * @param user the signed-in user
 * @param uploaderFamilyId the family of whoever uploaded the photo
 */
export const canManageImage = (
  user: SessionUser | null,
  uploaderFamilyId: string | null | undefined
): boolean => {
  if (user === null) return false;
  if (user.role === 'admin') return true;
  if (uploaderFamilyId === null || uploaderFamilyId === undefined) return false;
  return user.person.familyId === uploaderFamilyId;
};

/**
 * Prisma `where` fragment limiting photos to the ones a user may see.
 *
 * A group's yearbook is its own: you see what your family uploaded and nothing else.
 * Signed-out callers see nothing -- the impossible id is there so a missing user can never
 * accidentally widen a query to "all photos".
 *
 * Admins are deliberately NOT exempt. An admin uploading their own family's photos wants
 * their own family's month pages, not every group's pictures mixed in; the admin dashboard
 * is the one place that sees across groups, and it queries without this fragment rather
 * than widening it. `canManageImage` still lets an admin edit anything they can reach.
 *
 * Every query that lists or counts photos must spread this in, or a page will quietly
 * show another family's pictures.
 */
export const visibleImagesWhere = (user: SessionUser | null) => {
  if (user === null) return { id: '__nobody__' };
  return { uploadedBy: { person: { familyId: user.person.familyId } } };
};

export const isAdmin = (user: SessionUser | null): boolean => user?.role === 'admin';

/**
 * Gate an admin-only load or action. Throws rather than returning, so a caller cannot
 * forget to check the result and carry on.
 */
export const requireAdmin = (user: SessionUser | null): SessionUser => {
	if (user === null) error(401, 'Not signed in');
	// 404 rather than 403: the admin area's existence is not a normal user's business.
	if (user.role !== 'admin') error(404, 'Not found');
	return user;
};

/** Prisma `select` for the fields `canManageImage` needs from an image's uploader. */
export const UPLOADER_SELECT = {
  uploadedBy: { select: { person: { select: { familyId: true } } } }
} as const;
