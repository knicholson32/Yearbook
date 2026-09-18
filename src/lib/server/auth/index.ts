import jwt from 'jsonwebtoken';
import type { JwtHeader, SigningKeyCallback, JwtPayload, VerifyOptions } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { prisma } from '$lib/server/db';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

// Which Cloudflare Access application to trust. These are per-deployment: a second
// hostname is usually a second Access application with its own audience tag, and a token
// minted for one is rejected by the other. Overridable so the same image can be pointed at
// a different tunnel without a rebuild; the defaults are the existing dev application.
const TEAM_DOMAIN = env.CF_ACCESS_TEAM_DOMAIN ?? 'UNSET';
const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const APPLICATION_AUDIENCE =
  env.CF_ACCESS_AUD ?? 'UNSET'

if (TEAM_DOMAIN === 'UNSET') {
  throw new Error('Unset tokens. Set "CF_ACCESS_AUD" and "CF_ACCESS_TEAM_DOMAIN" environmental variables.');
}

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

    if (env.DEV_TUNNEL !== '1' && (APPLICATION_AUDIENCE === 'UNSET' || TEAM_DOMAIN === 'UNSET')) {
      return reject(new Error('Unset tokens. Set "CF_ACCESS_AUD" and "CF_ACCESS_TEAM_DOMAIN" environmental variables.'))
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

export type SessionUser = NonNullable<Awaited<ReturnType<typeof lookupUser>>>;

const lookupUser = async (email: string) => {
  return await prisma.user.findUnique({
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
};

/**
 * Whether nobody is an administrator yet.
 *
 * Only true on a database that has never had one, which in practice means a fresh install:
 * the first person to create an account is whoever is standing the server up, so they are
 * made an administrator and can promote everyone else from the dashboard. Once one exists
 * this is false forever and admin comes only from `User.role`.
 */
export const noAdminExists = async (): Promise<boolean> =>
  (await prisma.user.count({ where: { role: 'admin' } })) === 0;

/** Loopback and RFC1918 addresses, including IPv4-mapped IPv6 forms. */
const isLocalAddress = (address: string): boolean => {
  const a = address.replace(/^::ffff:/i, '');
  if (a === '::1' || a === 'localhost') return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(a)) return true; // fc00::/7, unique local
  if (/^fe80:/i.test(a)) return true; // link local
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (m === null) return false;
  const [x, y] = [Number(m[1]), Number(m[2])];
  if (x === 127) return true;
  if (x === 10) return true;
  if (x === 192 && y === 168) return true;
  if (x === 172 && y >= 16 && y <= 31) return true; // includes Docker's bridge
  return false;
};

/**
 * Whether an unauthenticated request may name itself with the email header alone.
 *
 * Only for running the app on a developer's own machine, where there is no Access in front
 * to mint a token. Two conditions, both required:
 *
 *  - No `cf-access-jwt-assertion` at all. Anything that came through the tunnel carries one,
 *    and a request that carries one is verified rather than trusted, so a caller cannot
 *    downgrade itself by sending a bad token -- an unparseable token is a 403, not a bypass.
 *  - The connection came from loopback or a private range.
 *
 * And never in the packaged image, whatever the address looks like. `cloudflared` dials the
 * origin from loopback, so a tunnel pointed at a hostname with no Access policy would arrive
 * JWT-less from 127.0.0.1 and otherwise hand the whole internet an admin login.
 */
const mayTrustEmailHeader = (event: RequestEvent): boolean => {
  if (env.YEARBOOK_PACKAGED === '1') return false;
  try {
    return isLocalAddress(event.getClientAddress());
  } catch {
    return false;
  }
};

/**
 * Resolve the signed-in user for a request.
 *
 * The identity comes out of the *verified* token, not out of
 * `cf-access-authenticated-user-email`. That header is set by Cloudflare Access but nothing
 * stops a caller who can reach the origin from writing it themselves, so trusting it while
 * also validating the JWT would leave every account -- admin included -- impersonable by
 * anyone holding any valid token for this application.
 */
export const getSession = async (event: RequestEvent) => {
  const token = event.request.headers.get('cf-access-jwt-assertion');

  if (token === null || token === '') {
    if (!mayTrustEmailHeader(event)) error(403, 'Access denied');
    const email = event.request.headers.get('cf-access-authenticated-user-email');
    console.warn(
      `No Access token on a local request; trusting the email header (${email ?? 'none'}). ` +
        'This never happens in the packaged image.'
    );
    return { email, user: email === null ? null : await lookupUser(email) };
  }

  let payload: JwtPayload;
  try {
    payload = await validateCloudflareJWT(token);
  } catch (e) {
    console.error('JWT validation failed:', e);
    error(403, 'Access denied');
  }

  // Service tokens authenticate an application rather than a person and carry no email;
  // there is no account for them to be, so they get no session.
  const email = typeof payload.email === 'string' && payload.email !== '' ? payload.email : null;
  if (email === null) error(403, 'Access denied');

  return { email, user: await lookupUser(email) };
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
