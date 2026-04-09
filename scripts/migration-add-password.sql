-- Add password column to users table for email/password credentials auth
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;
