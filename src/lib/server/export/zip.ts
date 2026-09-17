/**
 * A minimal streaming ZIP writer.
 *
 * Written here rather than pulled in as a dependency: the archive holds JPEGs, which are
 * already compressed, so the only method needed is STORE. That removes the part of the
 * format a library actually earns its keep on, and what is left is headers.
 *
 * Entries are written one at a time to a file handle and never buffered as a whole, so an
 * export is bounded by the largest single photo rather than by the size of the archive.
 *
 * ZIP64 is emitted when the archive needs it -- past 4GB or 65535 entries, which a year of
 * full-resolution photos can genuinely reach. Per-entry sizes are known before each header
 * is written, so no data descriptors are involved.
 */

import fs from 'node:fs';

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;

/** Past this, a field has to move into a ZIP64 extra block. */
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

export const crc32 = (buffer: Buffer): number => {
	let c = 0xffffffff;
	for (let i = 0; i < buffer.length; i++) c = crcTable[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

/** MS-DOS date/time, which is what ZIP stores. Seconds have 2-second resolution. */
const dosDateTime = (date: Date): { time: number; date: number } => {
	// Pre-1980 cannot be represented; clamp rather than writing a negative year.
	const year = Math.max(1980, date.getFullYear());
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
		date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
	};
};

interface Entry {
	name: Buffer;
	crc: number;
	size: number;
	offset: number;
	time: number;
	date: number;
}

/**
 * Make a path safe to appear inside an archive.
 *
 * Anything that could escape the extraction directory or upset a consumer is replaced:
 * separators are kept only where we put them, so a caption or a family label cannot invent
 * a new directory level or walk upwards.
 */
export const sanitizeSegment = (segment: string): string => {
	const cleaned = segment
		.replace(/[/\\]/g, '-')
		.replace(/[\x00-\x1f\x7f]/g, '')
		// Reserved on Windows, and a colon breaks extraction on macOS in the Finder.
		.replace(/[:*?"<>|]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		// A trailing dot or space is silently dropped by Windows, which would collide.
		.replace(/[. ]+$/, '');

	return cleaned.length === 0 ? 'untitled' : cleaned.slice(0, 120);
};

export class ZipWriter {
	private fd: number;
	private offset = 0;
	private entries: Entry[] = [];
	/** Names already used, so a duplicate gets a suffix instead of silently overwriting. */
	private used = new Set<string>();

	constructor(private path: string) {
		this.fd = fs.openSync(path, 'w');
	}

	private write(buffer: Buffer): void {
		fs.writeSync(this.fd, buffer);
		this.offset += buffer.length;
	}

	/**
	 * Give a path a numeric suffix if it is already in the archive. Two families can easily
	 * upload photos with the same original filename.
	 */
	private unique(path: string): string {
		if (!this.used.has(path)) {
			this.used.add(path);
			return path;
		}

		const dot = path.lastIndexOf('.');
		const stem = dot > 0 ? path.slice(0, dot) : path;
		const ext = dot > 0 ? path.slice(dot) : '';
		for (let n = 2; ; n++) {
			const candidate = `${stem} (${n})${ext}`;
			if (!this.used.has(candidate)) {
				this.used.add(candidate);
				return candidate;
			}
		}
	}

	/**
	 * Append one file.
	 * @param path the path inside the archive, with `/` separators
	 * @param data the file contents
	 * @param modified the timestamp to record
	 */
	add(path: string, data: Buffer, modified: Date = new Date()): void {
		const name = Buffer.from(this.unique(path), 'utf8');
		const { time, date } = dosDateTime(modified);
		const crc = crc32(data);
		const offset = this.offset;

		const header = Buffer.alloc(30);
		header.writeUInt32LE(LOCAL_HEADER, 0);
		header.writeUInt16LE(20, 4); // version needed: 2.0, STORE
		header.writeUInt16LE(0x0800, 6); // UTF-8 names
		header.writeUInt16LE(0, 8); // method: STORE
		header.writeUInt16LE(time, 10);
		header.writeUInt16LE(date, 12);
		header.writeUInt32LE(crc, 14);
		header.writeUInt32LE(data.length, 18);
		header.writeUInt32LE(data.length, 22);
		header.writeUInt16LE(name.length, 26);
		header.writeUInt16LE(0, 28);

		this.write(header);
		this.write(name);
		this.write(data);

		this.entries.push({ name, crc, size: data.length, offset, time, date });
	}

	/** Number of files added so far. */
	get count(): number {
		return this.entries.length;
	}

	/** Bytes written so far. */
	get bytes(): number {
		return this.offset;
	}

	/** Write the central directory and close the file. Returns the archive size. */
	close(): number {
		const start = this.offset;

		for (const entry of this.entries) {
			// Only the offset can overflow for our entry sizes: a single photo is never 4GB,
			// but its position in the archive can be past that mark.
			const needsZip64 = entry.offset > U32_MAX;
			const extra = needsZip64 ? Buffer.alloc(12) : Buffer.alloc(0);
			if (needsZip64) {
				extra.writeUInt16LE(0x0001, 0);
				extra.writeUInt16LE(8, 2);
				extra.writeBigUInt64LE(BigInt(entry.offset), 4);
			}

			const central = Buffer.alloc(46);
			central.writeUInt32LE(CENTRAL_HEADER, 0);
			central.writeUInt16LE(needsZip64 ? 45 : 20, 4); // version made by
			central.writeUInt16LE(needsZip64 ? 45 : 20, 6); // version needed
			central.writeUInt16LE(0x0800, 8);
			central.writeUInt16LE(0, 10);
			central.writeUInt16LE(entry.time, 12);
			central.writeUInt16LE(entry.date, 14);
			central.writeUInt32LE(entry.crc, 16);
			central.writeUInt32LE(entry.size, 20);
			central.writeUInt32LE(entry.size, 24);
			central.writeUInt16LE(entry.name.length, 28);
			central.writeUInt16LE(extra.length, 30);
			central.writeUInt16LE(0, 32); // comment length
			central.writeUInt16LE(0, 34); // disk number
			central.writeUInt16LE(0, 36); // internal attributes
			central.writeUInt32LE(0, 38); // external attributes
			central.writeUInt32LE(needsZip64 ? U32_MAX : entry.offset, 42);

			this.write(central);
			this.write(entry.name);
			if (extra.length > 0) this.write(extra);
		}

		const directorySize = this.offset - start;
		const zip64 =
			this.entries.length > U16_MAX || start > U32_MAX || directorySize > U32_MAX;

		if (zip64) {
			const locatorOffset = this.offset;

			const record = Buffer.alloc(56);
			record.writeUInt32LE(EOCD64, 0);
			record.writeBigUInt64LE(BigInt(44), 4); // size of this record, less 12
			record.writeUInt16LE(45, 12);
			record.writeUInt16LE(45, 14);
			record.writeUInt32LE(0, 16);
			record.writeUInt32LE(0, 20);
			record.writeBigUInt64LE(BigInt(this.entries.length), 24);
			record.writeBigUInt64LE(BigInt(this.entries.length), 32);
			record.writeBigUInt64LE(BigInt(directorySize), 40);
			record.writeBigUInt64LE(BigInt(start), 48);
			this.write(record);

			const locator = Buffer.alloc(20);
			locator.writeUInt32LE(EOCD64_LOCATOR, 0);
			locator.writeUInt32LE(0, 4);
			locator.writeBigUInt64LE(BigInt(locatorOffset), 8);
			locator.writeUInt32LE(1, 16);
			this.write(locator);
		}

		const end = Buffer.alloc(22);
		end.writeUInt32LE(EOCD, 0);
		end.writeUInt16LE(0, 4);
		end.writeUInt16LE(0, 6);
		// Saturated when ZIP64 is in play; a reader that understands it looks at the EOCD64.
		end.writeUInt16LE(Math.min(this.entries.length, U16_MAX), 8);
		end.writeUInt16LE(Math.min(this.entries.length, U16_MAX), 10);
		end.writeUInt32LE(Math.min(directorySize, U32_MAX), 12);
		end.writeUInt32LE(Math.min(start, U32_MAX), 16);
		end.writeUInt16LE(0, 20);
		this.write(end);

		fs.closeSync(this.fd);
		return this.offset;
	}

	/** Close and remove a half-written archive after a failure. */
	abort(): void {
		try {
			fs.closeSync(this.fd);
		} catch (e) {
			// Already closed; the unlink below is what matters.
		}
		try {
			fs.unlinkSync(this.path);
		} catch (e) {
			// Nothing to clean up.
		}
	}
}
