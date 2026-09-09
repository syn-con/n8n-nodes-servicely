import { describe, expect, it } from 'vitest';

import { isPlainObject, validateBody, type ParameterDefinition } from '../validation';

const strict = { allowUnknownParameters: true, coerceTypes: false };

function define(
	key: string,
	type: ParameterDefinition['type'],
	description = '',
): ParameterDefinition {
	return { key, type, description };
}

describe('isPlainObject', () => {
	it('accepts objects only', () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(null)).toBe(false);
		expect(isPlainObject(new Date())).toBe(false);
		expect(isPlainObject('{}')).toBe(false);
	});
});

describe('validateBody', () => {
	it('accepts a body matching every declared type', () => {
		const result = validateBody(
			{ name: 'ada', score: 1.5, count: 3, active: true },
			[
				define('name', 'string'),
				define('score', 'number'),
				define('count', 'integer'),
				define('active', 'boolean'),
			],
			strict,
		);

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.parameters).toEqual({ name: 'ada', score: 1.5, count: 3, active: true });
	});

	it('reports every declared parameter that is missing', () => {
		const result = validateBody({ b: 'here' }, [define('a', 'string'), define('b', 'string')], strict);

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([{ key: 'a', message: 'Parameter "a" is required' }]);
		expect(result.parameters).toEqual({ b: 'here' });
	});

	it('lets a parameter that is not required be left out', () => {
		const result = validateBody(
			{ b: 'here' },
			[{ ...define('a', 'string'), required: false }, define('b', 'string')],
			strict,
		);

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		// Missing, rather than present as null: the workflow reads it as unsent
		expect(result.parameters).toEqual({ b: 'here' });
		expect('a' in result.parameters).toBe(false);
	});

	it('still type-checks a parameter that is not required when it is sent', () => {
		const definitions = [{ ...define('a', 'integer'), required: false }];

		expect(validateBody({ a: 'nope' }, definitions, strict).errors).toEqual([
			{ key: 'a', message: 'Parameter "a" must be an integer, but a string was received' },
		]);
		expect(validateBody({ a: 3 }, definitions, strict).parameters).toEqual({ a: 3 });
	});

	it('treats a definition that says nothing about being required as required', () => {
		expect(validateBody({}, [define('a', 'string')], strict).errors).toEqual([
			{ key: 'a', message: 'Parameter "a" is required' },
		]);
		expect(
			validateBody({}, [{ ...define('a', 'string'), required: true }], strict).valid,
		).toBe(false);
	});

	it('treats null as missing but an empty string as provided', () => {
		expect(validateBody({ a: null }, [define('a', 'string')], strict).valid).toBe(false);
		expect(validateBody({ a: '' }, [define('a', 'string')], strict).valid).toBe(true);
	});

	it('rejects a decimal for an integer but accepts it for a number', () => {
		expect(validateBody({ a: 1.5 }, [define('a', 'integer')], strict).errors).toEqual([
			{ key: 'a', message: 'Parameter "a" must be an integer, but a decimal number was received' },
		]);
		expect(validateBody({ a: 1.5 }, [define('a', 'number')], strict).valid).toBe(true);
	});

	it('rejects NaN and Infinity as numbers', () => {
		expect(validateBody({ a: Number.NaN }, [define('a', 'number')], strict).valid).toBe(false);
		expect(validateBody({ a: Number.POSITIVE_INFINITY }, [define('a', 'integer')], strict).valid).toBe(
			false,
		);
	});

	it('names the received type in the error', () => {
		expect(validateBody({ a: [] }, [define('a', 'string')], strict).errors).toEqual([
			{ key: 'a', message: 'Parameter "a" must be a string, but an array was received' },
		]);
		expect(validateBody({ a: {} }, [define('a', 'boolean')], strict).errors).toEqual([
			{ key: 'a', message: 'Parameter "a" must be a boolean, but an object was received' },
		]);
	});

	it('coerces strings into the declared type when asked to', () => {
		const coercing = { allowUnknownParameters: true, coerceTypes: true };
		const result = validateBody(
			{ name: 12, score: '1.5', count: '3', active: 'yes' },
			[
				define('name', 'string'),
				define('score', 'number'),
				define('count', 'integer'),
				define('active', 'boolean'),
			],
			coercing,
		);

		expect(result.valid).toBe(true);
		expect(result.parameters).toEqual({ name: '12', score: 1.5, count: 3, active: true });
	});

	it('still rejects a coerced decimal declared as an integer', () => {
		const result = validateBody({ a: '1.5' }, [define('a', 'integer')], {
			allowUnknownParameters: true,
			coerceTypes: true,
		});

		expect(result.valid).toBe(false);
	});

	it('reports unknown properties when they are not allowed', () => {
		const result = validateBody({ a: 'x', extra: 1 }, [define('a', 'string')], {
			allowUnknownParameters: false,
			coerceTypes: false,
		});

		expect(result.errors).toEqual([{ key: 'extra', message: 'Parameter "extra" is not allowed' }]);
	});
});
