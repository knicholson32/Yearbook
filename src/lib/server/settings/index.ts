import * as types from '$lib/types';
import { prisma } from '$lib/server/db';
import * as crypto from 'node:crypto';
import * as helpers from '$lib/server/helpers';
import type { Prisma } from '$base/generated/prisma/client';
import { env } from '$env/dynamic/private';

export const TypeNames = {
	'general.timezone': env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
	'general.encKey': 'UNSET',
	'general.familyName': '',
	'upload.monthColumns': 4,
	'upload.photosPerMonth': 4,
	'years.background': 'plain',
};

/** Valid values for `years.background`. Anything else falls back to the first. */
export const YEARS_BACKGROUNDS = ['plain', 'aurora'] as const;
export type YearsBackground = (typeof YEARS_BACKGROUNDS)[number];

/** Clamp for `upload.monthColumns`. One column is legible; past this the tiles are thumbnails. */
export const MONTH_COLUMNS_MIN = 1;
export const MONTH_COLUMNS_MAX = 8;

/** Clamp for `upload.photosPerMonth`, the number of photos each group is asked for per month. */
export const PHOTOS_PER_MONTH_MIN = 1;
export const PHOTOS_PER_MONTH_MAX = 100;

export type TypeName = keyof typeof TypeNames;

export type ObjectType<T extends TypeName> = 
	T extends 'general.timezone' ? string : 			// String
	T extends 'general.encKey' ? string : 				// String
	T extends 'upload.monthColumns' ? number : 			// Integer
	T extends 'upload.photosPerMonth' ? number : 		// Integer
	T extends 'general.familyName' ? string : 			// String
	T extends 'years.background' ? YearsBackground : 	// Enum
	string;

// -------------------------------------------------------------------------------------------------
// Settings
// -------------------------------------------------------------------------------------------------

export type SettingPayload = Prisma.SettingsGetPayload<{}>;

/**
 * Get a setting from the DB
 * @param setting the setting to get
 * @returns the setting
 */
export const get = async <T extends TypeName>(setting: T, settingVal?: SettingPayload | null): Promise<ObjectType<T>> => {
	// Make sure the setting can exist
	if (!(setting in TypeNames)) throw Error(`Unknown setting: ${setting}`);

	// TODO: Cache some of these settings? Maybe the frequent ones? That way we don't have to do a DB
	//       call every time. Would only make sense for some settings though. Makes even less sense
	//       now that we have `getMany`.

	// Pull the setting from the DB
	if (settingVal === undefined)
		settingVal = await prisma.settings.findUnique({ where: { setting } });

	// Check if it exists
	if (settingVal !== undefined && settingVal !== null) {
		// It does. Fetch, cast and return.
		switch (setting) {
			// Boolean Conversion ------------------------------------------------------------------------
			// case 'entry.entryMXMode':
			//	return (settingVal.value === 'true' ? true : false) as ObjectType<T>;

			// Integer Conversion ------------------------------------------------------------------------
			case 'upload.monthColumns': {
				// A bad row should degrade to the default rather than collapse the grid: `repeat(NaN, ...)`
				// is an invalid declaration, so the browser drops it and every tile stacks in one column.
				const parsed = parseInt(settingVal.value);
				if (!Number.isFinite(parsed)) return TypeNames['upload.monthColumns'] as ObjectType<T>;
				return Math.min(MONTH_COLUMNS_MAX, Math.max(MONTH_COLUMNS_MIN, parsed)) as ObjectType<T>;
			}
			case 'upload.photosPerMonth': {
				const parsed = parseInt(settingVal.value);
				if (!Number.isFinite(parsed)) return TypeNames['upload.photosPerMonth'] as ObjectType<T>;
				return Math.min(PHOTOS_PER_MONTH_MAX, Math.max(PHOTOS_PER_MONTH_MIN, parsed)) as ObjectType<T>;
			}

			// Float Conversion --------------------------------------------------------------------------
			// case '':
			// 	return parseFloat(settingVal.value) as ObjectType<T>;

			// String Conversion -------------------------------------------------------------------------
			case 'general.timezone':
			case 'general.encKey':
			case 'general.familyName':
				return settingVal.value as ObjectType<T>;

			// Encrypted Strings -------------------------------------------------------------------------
			// case 'general.aeroAPI':
			// 	return (await helpers.decrypt(settingVal.value)) as ObjectType<T>;

			// Enum Conversion ---------------------------------------------------------------------------
			case 'years.background': {
				// An unrecognised value would otherwise reach the page as a class name that
				// matches no rule, leaving the shelf with no background at all.
				const value = settingVal.value as YearsBackground;
				return (YEARS_BACKGROUNDS.includes(value) ? value : YEARS_BACKGROUNDS[0]) as ObjectType<T>;
			}

			// Unknown -----------------------------------------------------------------------------------
			default:
				throw Error(`Unknown setting: ${setting}`);
		}
	} else {
		// It does not. Assign the default to the DB and return the default value.

		// First, check if this is a setting that needs a special default
		if (setting === 'general.encKey') {
			// It is. Generate the default
			const defaultVal = crypto.randomBytes(32).toString('hex') as ObjectType<T>;
			await prisma.settings.create({ data: { setting, value: defaultVal.toString() } });
			// Return the default value
			return defaultVal;
		}

		// It is not. Get the default setting
		const defaultVal = TypeNames[setting] as unknown as ObjectType<T>;

		// Write the default value to the DB
		await prisma.settings.create({ data: { setting, value: defaultVal.toString() } });

		// Return the default value
		return defaultVal;
	}
};

// Generate two helpers types that will allow us to select based on the settings
export type SettingsSet<T extends TypeName, Prefix extends string> = T extends `${Prefix}.${infer Rest}` ? T : never;
type SettingsPrefix<T extends TypeName, Prefix extends string> = T extends `${Prefix}.${infer Rest}` ? Prefix : never;

/**
 * Get a set of settings, as long as they match a certain prefix
 * @param prefix the prefix to match
 * @returns an object with the settings
 */
export const getSet = async <Prefix extends string>(prefix: SettingsPrefix<TypeName, Prefix>): Promise<{ [K in SettingsSet<TypeName, Prefix>]: ObjectType<K> }> => {
	// Get the possible settings keys based on the prefix
	const keys = (Object.keys(TypeNames) as TypeName[]).filter((key) => key.startsWith(prefix)) as SettingsSet<TypeName, Prefix>[];
	// Initialize a resulting settings object, typed to only include the settings we will return
	const settings = {} as { [K in (typeof keys)[number]]: ObjectType<K> };

	// Get the settings from the DB
	const manySettings = await prisma.settings.findMany({where: { setting: { startsWith: prefix } } });

	// Loop through the possible settings
	for (const key of keys) {
		// If the setting does not exist, error. Since we generated the keys array right above this, we should never get this error.
		if (!(key in TypeNames)) throw Error(`Unknown setting: ${key}`);
		// Find the setting from the DB, if it is in there
		const keyIdx = manySettings.findIndex((s) => s.setting === key);
		// If it is, pass it to the basic `get` function so it can be properly cast
		if (keyIdx !== -1) settings[key] = (await get(key, manySettings[keyIdx])) as never;
		// If not, return a default value
		else settings[key] = TypeNames[key] as never;
	}

	// Return the settings
	return settings;
};

// Generate a helper type that will allow us to select based on settings
type FilterSettingsMany<T extends TypeName, Search extends string> = T extends `${Search}` ? T : never;

/**
 * Get many fully-qualified settings
 * @param settings the settings to get
 * @returns an object with the settings
 */
export const getMany = async <T extends TypeName>(...settings: T[]): Promise<{ [K in FilterSettingsMany<TypeName, T>]: ObjectType<K> }> => {
	// Get the possible settings keys based on the inputs. This protects against uncaught typescript errors
	const keys: TypeName[] = [];
	for (const setting of settings) if (setting in TypeNames) keys.push(setting);
	// Initialize a resulting settings object, typed to only include the settings we will return
	const results = {} as { [K in (typeof keys)[number]]: ObjectType<K> };

	// Get the settings from the DB
	const manySettings = await prisma.settings.findMany({ where: { setting: { in: settings } } });

	// Loop through the requested settings
	for (const key of keys) {
		// If the setting does not exist, error.
		if (!(key in TypeNames)) throw Error(`Unknown setting: ${key}`);
		// Find the setting from the DB, if it is in there
		const keyIdx = manySettings.findIndex((s) => s.setting === key);
		// If it is, pass it to the basic `get` function so it can be properly cast
		if (keyIdx !== -1) results[key] = (await get(key, manySettings[keyIdx])) as never;
		// If not, return a default value
		else results[key] = TypeNames[key] as never;
	}

	// Return the settings
	return results;
};

/**
 * Set a setting in the database
 * @param setting the setting to modify
 * @param value the value to set it to
 */
export const set = async <T extends TypeName>(setting: T, value: ObjectType<T>) => {
	// Make sure the setting can exist
	if (!(setting in TypeNames)) throw Error(`Unknown setting: ${setting}`);

	// if (setting === 'general.aeroAPI') {
	// 	value = (await helpers.encrypt(value as string)) as ObjectType<T>;
	// }

	// Create or modify the value
	await prisma.settings.upsert({
		create: {
			setting,
			value: value.toString()
		},
		update: {
			value: value.toString()
		},
		where: { setting }
	});
};
