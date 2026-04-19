-- Track why a position was closed (TP_EXIT, TP_EXIT_SHORT, TSL, TSL_SHORT, SIGNAL)
ALTER TABLE trades ADD COLUMN close_reason TEXT;
