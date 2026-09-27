import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl
});

export const query = (text, params = []) => pool.query(text, params);

export const poolStatus = () => ({
  totalConnections: pool.totalCount,
  idleConnections: pool.idleCount,
  waitingRequests: pool.waitingCount
});