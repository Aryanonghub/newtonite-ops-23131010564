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
});
