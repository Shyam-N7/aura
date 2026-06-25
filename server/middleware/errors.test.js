import { describe, it, expect } from 'vitest';
import { clientError } from './errors.js';

describe('clientError', () => {
  it('exposes intentional 4xx messages (curated, caller-facing)', () => {
    expect(clientError({ statusCode: 404, message: 'playlist not found' })).toBe('playlist not found');
    expect(clientError({ statusCode: 400, message: 'bad input' })).toBe('bad input');
  });

  it('hides 5xx / unknown errors behind a generic message (no internals leak)', () => {
    expect(clientError({ statusCode: 500, message: 'pg: relation "x" does not exist' })).toBe('something went wrong');
    expect(clientError(new Error('boom'))).toBe('something went wrong');
  });

  it('honors the expose flag in both directions', () => {
    // expose:false hides even a 4xx (e.g. catalog body-bearing 404)
    expect(clientError({ statusCode: 404, expose: false, message: 'catalog 404: <raw body>' })).toBe('not found');
    // expose:true shows even a 5xx (intentional)
    expect(clientError({ statusCode: 500, expose: true, message: 'shown anyway' })).toBe('shown anyway');
  });
});
