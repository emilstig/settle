-- Tokens and an estimated cost per Claude call, so the cost per active user
-- can be followed (goal: under 0.50 SEK per active user and month).
-- input_tokens counts all input, cached or not; cost_usd uses list prices
-- for the model that served the call (see src/lib/suggest/cost.ts).
alter table public.suggest_runs
  add column input_tokens int,
  add column output_tokens int,
  add column cost_usd numeric(12, 6);
