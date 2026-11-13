# cbBTC/USDC entry

This is a deterministic Node 22 TypeScript bot for `agent-fun/bars-replay/v1`. It reads newline-delimited `hello`, `batch`, and `done` messages through the unmodified SDK shim at `vendor/makefun-bars.ts`, and replies once per batch with the matching sequence number handled by the shim.

## Strategy

The bot holds at most one long CBBTC position. It updates 55-bar and 240-bar EMAs from every received close, seeding each EMA on the first close. It ignores entry signals through the first 240 closes, then buys only on a fast-over-slow crossover while flat. A buy requests up to 95% of equity, bounded by cash, `weightRoom`, and the SDK's estimated impact at 8 bps. The 8 bps headroom leaves room below the 10 bps target.

The full position is sold when its marked value is at least 1.0% over its fee-inclusive cost, when the close falls 0.9% below the highest close since entry, or when the fast EMA crosses back below the slow EMA. Every order sets an 80 bps max slippage. New full-size trend entries stop at elapsed minute 1410. If there has been no own fill and the bot is flat with no pending order, the late guardrail fallback submits one 1.000017 USDC buy when 1,400 minutes have elapsed from the first observed bar or the batch sequence reaches 1,400. Using bar time covers windows with missing-minute bars.

Signals are calculated once for each `batch` bar received; each reply echoes that batch's sequence through the SDK shim, and its orders can fill only at the following bar's open. The parameter replay sweep found positive estimates around fast spans 50–65, slow spans 230–250, and trailing stops from 0.6% to 1.2%; the selected 55/240/0.9% settings were then scored by the kit grader.

## Run and grade

Run from this repository with Node 22:

```sh
node main.ts
```

The local parameter replay is:

```sh
node backtest.ts
```

The official kit command is:

```sh
cd /home/box/makefun/btc-race-kit
node cli/makefun.mjs grade-local --kit . --bot /home/box/makefun/btc-entry --driver process --worktree
```

## Final local dev grade

- Net PnL: **+2.943294 USDC**
- Trades: **4**
- Maximum drawdown: **0.004016414** (about **0.402%**)
- Guardrails: **met**
- L1 regrade: **reproduced byte for byte**

The grade used the exact command above. The kit also notes this machine runs Node v24.22.1 rather than the server's v22.23.4, so its result hash cannot equal a server's container hash.
