/**
 * List prices in USD per million tokens, for the estimated cost logged in
 * suggest_runs. Cache writes cost 1.25× input and cache reads 0.1× input.
 * A model missing here (a fallback, say) is logged without a cost.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
};

type Usage = {
  input_tokens: number | null;
  output_tokens: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type RunCost = {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
};

/** Tokens and estimated cost of one response, for its suggest_runs row. */
export function runCost(model: string, usage: Usage): RunCost {
  const fresh = usage.input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const price = PRICES[model];
  const cost = price
    ? ((fresh + written * 1.25 + read * 0.1) * price.input +
        output * price.output) /
      1_000_000
    : null;
  return {
    input_tokens: fresh + written + read,
    output_tokens: output,
    cost_usd: cost === null ? null : Math.round(cost * 1e6) / 1e6,
  };
}
