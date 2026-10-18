import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, seedFixture, type Fixture } from './helpers';

describe('login', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  it('returns a token that works on /me', async () => {
    const login = await api().post('/auth/login').send({ email: 'alice@test.local', password: 'password123' }).expect(200);

    const me = await api().get('/me').set(auth(login.body.token)).expect(200);

    expect(me.body).toMatchObject({ id: f.alice.id, teams: [{ name: 'Payments', role: 'member' }] });
  });

  it('gives the same 401 for a wrong password and an unknown email', async () => {
    const wrong = await api().post('/auth/login').send({ email: 'alice@test.local', password: 'nope' });
    const unknown = await api().post('/auth/login').send({ email: 'ghost@test.local', password: 'password123' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  describe('rate limiting', () => {
    const login = (email: string, password: string) => api().post('/auth/login').send({ email, password });
    const failFiveTimes = async (email: string) => {
      for (let i = 0; i < 5; i++) await login(email, 'wrong').expect(401);
    };

    it('after 5 wrong passwords, even the right one gets 429 with Retry-After', async () => {
      await failFiveTimes('alice@test.local');

      const res = await login('alice@test.local', 'password123');

      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(res.body.error).toMatch(/Too many failed logins/);
    });

    it('is counted per email, so other accounts can still log in', async () => {
      await failFiveTimes('alice@test.local');

      await login('bob@test.local', 'password123').expect(200);
    });

    it('also limits guesses against an unknown email (no hint that it does not exist)', async () => {
      await failFiveTimes('ghost@test.local');

      await login('ghost@test.local', 'anything').expect(429);
    });

    it('a successful login resets the count', async () => {
      for (let i = 0; i < 4; i++) await login('alice@test.local', 'wrong').expect(401);
      await login('alice@test.local', 'password123').expect(200);

      await login('alice@test.local', 'wrong').expect(401); // back to 1 failure, not 5
      await login('alice@test.local', 'password123').expect(200);
    });

    it('email case does not matter', async () => {
      await failFiveTimes('ALICE@test.local');

      await login('alice@test.local', 'password123').expect(429);
    });
  });
});
