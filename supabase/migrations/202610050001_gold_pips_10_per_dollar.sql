UPDATE public.trades
SET pips = abs(exit - entry) / 0.1
WHERE upper(symbol) IN ('GOLD', 'GOLD24-7', 'XAUUSD');
