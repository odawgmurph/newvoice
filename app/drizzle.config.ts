import type { Config } from 'drizzle-kit';

// Generate a migration after changing src/db/schema.ts:
//   npm run db:generate
// Migrations are committed and run on app start (src/db/client.ts).
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  driver: 'expo',
} satisfies Config;
