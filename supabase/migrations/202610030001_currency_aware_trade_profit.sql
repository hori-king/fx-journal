ALTER TABLE public.trades
ADD COLUMN IF NOT EXISTS profit_currency text,
ADD COLUMN IF NOT EXISTS conversion_rate numeric;

UPDATE public.trades
SET profit_currency = CASE
      WHEN upper(symbol) IN ('NIKKEI', 'JP225', 'JP225CASH') THEN 'JPY'
      WHEN upper(symbol) IN ('GOLD', 'GOLD24-7', 'SILVER', 'PALL', 'PLAT', 'BTCUSD', 'ETHUSD') THEN 'USD'
      WHEN upper(symbol) IN ('US100', 'US100CASH', 'US30', 'US30CASH', 'US500', 'US500CASH', 'US2000CASH') THEN 'USD'
      WHEN upper(symbol) ~ '^[A-Z]{6}$' THEN right(upper(symbol), 3)
      ELSE coalesce(profit_currency, 'USD')
    END,
    conversion_rate = coalesce(conversion_rate, 1),
    profit = (CASE WHEN upper(direction) = 'BUY' THEN exit - entry ELSE entry - exit END)
      * lot
      * CASE
          WHEN upper(symbol) IN ('GOLD', 'GOLD24-7') THEN 100
          WHEN upper(symbol) = 'SILVER' THEN 5000
          WHEN upper(symbol) IN ('PALL', 'PLAT') THEN 10
          WHEN upper(symbol) = 'BTCUSD' THEN 1
          WHEN upper(symbol) = 'ETHUSD' THEN 1
          WHEN upper(symbol) ~ '^[A-Z]{6}$' THEN 100000
          ELSE 1
        END
WHERE profit_currency IS NULL;
