-- Store contract vol per trade for LIFO partial closes
ALTER TABLE trades ADD COLUMN vol INTEGER;
