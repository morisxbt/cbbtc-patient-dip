import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

type Bar = { o: string; c: string; o_depth: string[]; c_depth: string[] };
const bars = gunzipSync(readFileSync('/home/box/makefun/btc-race-kit/dataset/bars/CBBTC.ndjson.gz'))
  .toString('utf8').trim().split('\n').map((line) => JSON.parse(line) as Bar);

const FEE = 8 / 10_000;
const SLIPPAGE = 2 / 10_000;
const START_CASH = 1_000_000_000;

function replay(fastSpan: number, slowSpan: number, trailingBps: number) {
  let fast: number | null = null;
  let slow: number | null = null;
  let previousGap: number | null = null;
  let cash = START_CASH;
  let qty = 0;
  let cost = 0;
  let pending: 'buy' | 'sell' | null = null;
  let pendingBuyAmount = 0;
  let peak = START_CASH;
  let maxDrawdown = 0;
  let highest = 0;
  let holding = false;
  let ownFills = 0;
  const trades = { buys: 0, sells: 0 };

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const open = Number(bar.o);
    if (pending !== null && i > 0) {
      const depth = Number(bar.o_depth[0]);
      if (pending === 'buy' && qty === 0) {
        const spend = Math.min(cash, pendingBuyAmount);
        const net = spend * (1 - FEE);
        const fillPrice = open * (1 + SLIPPAGE) * (1 + net / depth);
        qty = net * 1e7 / fillPrice;
        cost = spend;
        cash -= spend;
        ownFills++;
        trades.buys++;
      } else if (pending === 'sell' && qty > 0) {
        const notional = qty * open / 1e7;
        const proceeds = notional / (1 + notional / depth) * (1 - SLIPPAGE) * (1 - FEE);
        cash += proceeds;
        qty = 0;
        cost = 0;
        ownFills++;
        trades.sells++;
      }
      pending = null;
    }

    const close = Number(bar.c);
    fast = fast === null ? close : fast + (2 / (fastSpan + 1)) * (close - fast);
    slow = slow === null ? close : slow + (2 / (slowSpan + 1)) * (close - slow);
    const gap = fast - slow;
    const crossedUp = previousGap !== null && previousGap <= 0 && gap > 0;
    const crossedDown = previousGap !== null && previousGap >= 0 && gap < 0;
    previousGap = gap;

    if (qty === 0) {
      holding = false;
      highest = 0;
    } else if (!holding) {
      holding = true;
      highest = close;
    } else {
      highest = Math.max(highest, close);
    }

    if (qty > 0 && pending === null) {
      const value = qty * close / 1e7;
      const takeProfit = value * 10_000 >= cost * 10_100;
      const trailingStop = close * 10_000 <= highest * (10_000 - trailingBps);
      if (takeProfit || trailingStop || crossedDown) pending = 'sell';
    } else if (qty === 0 && pending === null) {
      if (i >= slowSpan && ownFills === 0 && i >= 1420) {
        pending = 'buy';
        pendingBuyAmount = 1_000_017;
      } else if (i + 1 > slowSpan && crossedUp) {
        const depth = Number(bar.c_depth[0]);
        const amount = Math.min(cash * 0.95, depth * 8 / 10_000);
        if (amount >= 1_000_000) {
          pending = 'buy';
          pendingBuyAmount = amount;
        }
      }
    }

    const equity = cash + qty * close / 1e7;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / START_CASH);
  }

  if (qty > 0) {
    const finalBar = bars.at(-1)!;
    const close = Number(finalBar.c);
    const depth = Number(finalBar.c_depth[0]);
    const notional = qty * close / 1e7;
    cash += notional / (1 + notional / depth) * (1 - SLIPPAGE) * (1 - FEE);
    ownFills++;
    trades.sells++;
  }
  return {
    fastSpan, slowSpan, trailingBps,
    pnl: (cash - START_CASH) / 1e6,
    buys: trades.buys, sells: trades.sells, trades: trades.buys + trades.sells,
    maxDrawdown: Math.max(maxDrawdown, (START_CASH - cash) / START_CASH),
    ownFills,
  };
}

for (const fastSpan of [50, 55, 60, 65, 70]) {
  for (const slowSpan of [220, 230, 240, 250, 260]) {
    for (const trailingBps of [60, 90, 120]) {
      const result = replay(fastSpan, slowSpan, trailingBps);
      if (result.pnl > 0) console.log(result);
    }
  }
}
