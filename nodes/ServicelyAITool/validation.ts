import type { IDataObject } from 'n8n-workflow';

/**
 * Types a tool parameter can be declared as in the node UI. These are the types a
 * Servicely service desk tool definition can express, so the list is deliberately
 * narrow — no arrays or objects.
 */
export type ParameterType = 'boolean' | 'integer' | 'number' | 'string';

export interface ParameterDefinition {
	key: string;
	type: ParameterType;
	/** What the parameter means, exported with the tool so the agent knows what to send. */
	description: string;
}

export interface ValidationError {
	key: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
	/** The declared parameters that were present in the body, after optional type coercion. */
	parameters: IDataObject;
}

export interface ValidationOptions {
	allowUnknownParameters: boolean;
	coerceTypes: boolean;
}

const TYPE_LABELS: Record<ParameterType, string> = {
	boolean: 'a boolean',
	integer: 'an integer',
	number: 'a number',
	string: 'a string',
};

export function isPlainObject(value: unknown): value is IDataObject {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		!Buffer.isBuffer(value) &&
		!(value instanceof Date)
	);
}

function describe(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return 'an array';
	}
	if (isPlainObject(value)) {
		return 'an object';
	}
	if (typeof value === 'number' && !Number.isFinite(value)) {
		return 'a non-finite number';
	}
	if (typeof value === 'number' && !Number.isInteger(value)) {
		return 'a decimal number';
	}
	return `a ${typeof value}`;
}

/**
 * Best effort conversion of values that arrive as strings (form submissions, query-like bodies)
 * into the declared type. Values that cannot be converted are returned unchanged so that the
 * type check below still reports them as invalid.
 */
function coerce(value: unknown, type: ParameterType): unknown {
	switch (type) {
		case 'string':
			return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value;
		case 'integer':
		case 'number': {
			if (typeof value !== 'string' || value.trim() === '') {
				return value;
			}
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed : value;
		}
		case 'boolean': {
			if (value === 1) {
				return true;
			}
			if (value === 0) {
				return false;
			}
			if (typeof value !== 'string') {
				return value;
			}
			const normalized = value.trim().toLowerCase();
			if (['true', '1', 'yes', 'on'].includes(normalized)) {
				return true;
			}
			if (['false', '0', 'no', 'off'].includes(normalized)) {
				return false;
			}
			return value;
		}
		// no default
	}
}

function matchesType(value: unknown, type: ParameterType): boolean {
	switch (type) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number' && Number.isFinite(value);
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		// no default
	}
}

/**
 * Validates a request body against the parameter definitions configured on the node.
 * Every declared parameter has to be present: `undefined` and `null` count as missing,
 * an empty string counts as provided.
 */
export function validateBody(
	body: IDataObject,
	definitions: ParameterDefinition[],
	options: ValidationOptions,
): ValidationResult {
	const errors: ValidationError[] = [];
	const parameters: IDataObject = {};

	for (const definition of definitions) {
		const raw = body[definition.key];

		if (raw === undefined || raw === null) {
			errors.push({
				key: definition.key,
				message: `Parameter "${definition.key}" is required`,
			});
			continue;
		}

		const value = options.coerceTypes ? coerce(raw, definition.type) : raw;

		if (!matchesType(value, definition.type)) {
			errors.push({
				key: definition.key,
				message: `Parameter "${definition.key}" must be ${TYPE_LABELS[definition.type]}, but ${describe(
					raw,
				)} was received`,
			});
			continue;
		}

		parameters[definition.key] = value as IDataObject[string];
	}

	if (!options.allowUnknownParameters) {
		const known = new Set(definitions.map((definition) => definition.key));
		for (const key of Object.keys(body)) {
			if (!known.has(key)) {
				errors.push({ key, message: `Parameter "${key}" is not allowed` });
			}
		}
	}

	return { valid: errors.length === 0, errors, parameters };
}
