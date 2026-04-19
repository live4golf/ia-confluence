-- Add position_id column to track isolated margin positions for close orders
ALTER TABLE trades ADD COLUMN position_id TEXT;
