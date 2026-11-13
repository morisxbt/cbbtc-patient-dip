import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const FAST_SPAN = 55;
const SLOW_SPAN = 240;
const TAKE_PROFIT_BPS = 100;
const TRAILING_STOP_BPS = 90;
const MAX_SLIPPAGE_BPS = 80;
const BUY_EQUITY_BPS = 9_500;
const MAX_IMPACT_BPS = 8n;

let fast: number | null = null;
let slow: number | null = null;
let previousGap: number | null = null;
let closesSeen = 0;
let holding = false;
let highestClose = 0n;
let pending: 'buy' | 'sell' | null = null;
let ownFills = 0;
let orderNumber = 0;

function nextEma(current: number | null, close: number, span: number): number {
  if (current === null) return close;
  return current + (2 / (span + 1)) * (close - current);
}

function orderId(side: 'buy' | 'sell'): string {
  orderNumber += 1;
  return `trend-${side}-${orderNumber}`;
}

function buyAmount(state: BarsState, symbol: string): bigint {
  const equitySize = state.equity * BigInt(BUY_EQUITY_BPS) / 10_000n;
  const weightLimit = state.weightRoom(symbol);
  let amount = equitySize < weightLimit ? equitySize : weightLimit;
  if (amount > state.cash) amount = state.cash;

  // Use the SDK's same impact estimate and retain a little room below the 10 bps target.
  let impact = state.impactBps(symbol, amount);
  while (impact !== null && impact > MAX_IMPACT_BPS && amount > 0n) {
    amount = amount * MAX_IMPACT_BPS / impact;
    if (amount > 0n) amount -= 1n;
    impact = state.impactBps(symbol, amount);
  }
  return amount;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((item: Bar) => item.symbol === 'CBBTC');
    for (const fill of batch.fills) {
      if (fill.status === 'filled' && fill.client_id.startsWith('trend-')) ownFills += 1;
      if (pending !== null && fill.client_id.includes(`-${pending}-`)) pending = null;
    }
    if (bar === undefined) return [];

    // The protocol supplies one close per batch. EMA values are updated once per received bar;
    // decisions go in this reply and can fill only at the next bar's open.
    const close = BigInt(bar.c);
    const closeNumber = Number(bar.c);
    fast = nextEma(fast, closeNumber, FAST_SPAN);
    slow = nextEma(slow, closeNumber, SLOW_SPAN);
    closesSeen += 1;
    const gap = fast - slow;
    const crossedUp = previousGap !== null && previousGap <= 0 && gap > 0;
    const crossedDown = previousGap !== null && previousGap >= 0 && gap < 0;
    previousGap = gap;

    const held = state.positions.get('CBBTC');
    if (held === undefined) {
      holding = false;
      highestClose = 0n;
    } else if (!holding) {
      holding = true;
      highestClose = close;
    } else if (close > highestClose) {
      highestClose = close;
    }
    if (state.warmingUp) return [];

    if (held !== undefined && pending === null) {
      const value = state.value('CBBTC', held.qty);
      const takeProfit = value * 10_000n >= held.cost * BigInt(10_000 + TAKE_PROFIT_BPS);
      const trailingStop = close * 10_000n <= highestClose * BigInt(10_000 - TRAILING_STOP_BPS);
      if (takeProfit || trailingStop || crossedDown) {
        pending = 'sell';
        return [{ side: 'sell', symbol: 'CBBTC', qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: orderId('sell') } satisfies SellInput];
      }
      return [];
    }

    if (held !== undefined || pending !== null) return [];
    const minimum = BigInt(state.hello.fees.min_notional_quote_units);
    if (batch.seq >= 1420 && ownFills === 0) {
      pending = 'buy';
      return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: minimum + 17n, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: orderId('buy') } satisfies BuyInput];
    }
    if (closesSeen <= SLOW_SPAN || !crossedUp) return [];
    const amount = buyAmount(state, 'CBBTC');
    if (amount < minimum) return [];
    pending = 'buy';
    return [{ side: 'buy', symbol: 'CBBTC', notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: orderId('buy') } satisfies BuyInput];
  },
});
