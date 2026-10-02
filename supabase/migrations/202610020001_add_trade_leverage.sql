ALTER TABLE public.trades
ADD COLUMN IF NOT EXISTS leverage numeric;

ALTER TABLE public.trades
ADD CONSTRAINT trades_leverage_positive
CHECK (leverage IS NULL OR leverage > 0);

UPDATE public.trades
SET pips = abs(exit - entry) / CASE
  WHEN upper(symbol) = 'GOLD' THEN 0.01
  WHEN upper(symbol) = 'NIKKEI' THEN 1
  WHEN upper(symbol) LIKE '%JPY' THEN 0.01
  ELSE 0.0001
END;
