-- Store Pine bar timestamp for matching closes to opens
ALTER TABLE trades ADD COLUMN entry_time TEXT;
