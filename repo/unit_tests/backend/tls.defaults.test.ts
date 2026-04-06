import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getAuthCookieOptions } from '../../backend/src/modules/auth/auth.constants';

describe('tls/security defaults', () => {
  it('uses strict secure cookie defaults', () => {
    const cookie = getAuthCookieOptions();

    expect(cookie.secure).toBe(true);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('strict');
  });

  it('docker-compose enables caddy TLS proxy by default (no profile gate)', () => {
    const composePath = resolve(__dirname, '../../docker-compose.yml');
    const compose = readFileSync(composePath, 'utf-8');

    // Caddy service should NOT be behind a profile
    const caddySection = compose.slice(compose.indexOf('caddy:'));
    const nextService = caddySection.indexOf('\n\nvolumes:');
    const caddyBlock = caddySection.slice(0, nextService > 0 ? nextService : undefined);

    expect(caddyBlock).not.toContain('profiles:');
    expect(compose).toContain('caddy:');
    expect(compose).toContain('443:443');
  });

  it('backend does not expose ports directly to host', () => {
    const composePath = resolve(__dirname, '../../docker-compose.yml');
    const compose = readFileSync(composePath, 'utf-8');

    // Find the backend section
    const backendStart = compose.indexOf('  backend:');
    const frontendStart = compose.indexOf('  frontend:');
    const backendSection = compose.slice(backendStart, frontendStart);

    // Should use expose (internal only), not ports (host-exposed)
    expect(backendSection).toContain('expose:');
    expect(backendSection).not.toMatch(/^\s+ports:/m);
  });
});
