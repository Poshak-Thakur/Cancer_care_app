const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

// Use DIRECT_URL (port 5432) to bypass Supabase's PgBouncer.
// The 'pg' module handles its own high-performance connection pooling.
const pool = new Pool({ 
    connectionString: process.env.DIRECT_URL 
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

module.exports = prisma;