// Phase 3: the demo accounts now live for real in the Django backend (see
// backend/accounts/management/commands/seed_demo_users.py), seeded with this exact shared
// password. This constant survives Phase 1's own lib/mocks/users.ts (now deleted, its seed data
// replaced by the real database) purely so the login page can keep showing the same "try these
// demo accounts" hint it always has.
export const DEMO_PASSWORD = 'password123';
