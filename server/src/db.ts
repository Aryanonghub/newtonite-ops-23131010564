import { Pool } from 'pg';
import { config } from './config';

// One shared connection pool for the whole process.
// Each request borrows a connection and gives it back when done.
export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
