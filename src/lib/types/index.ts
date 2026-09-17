// import type { Prisma } from '@prisma/client';

export * from './prisma';

export { default as API } from './api';


// ------------------------------------------------------------------------------------------------
// Application Enums
// ------------------------------------------------------------------------------------------------


export enum ImageUploadState {
	NO_CHANGE = 'NO_CHANGE',
	UPDATE = 'UPDATE',
	DELETE = 'DELETE'
}