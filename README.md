# botc-zdd

A TypeScript library for encoding [Blood on the Clocktower](https://bloodontheclocktower.com/) (BotC) role distributions using [Zero-suppressed Decision Diagrams](https://en.wikipedia.org/wiki/Zero-suppressed_decision_diagram) (ZDDs).

## Motivation

This project builds a ZDD-based engine that can replace or complement the ASP (Answer Set Programming) solver in [pnkfelix/botc-asp](https://github.com/pnkfelix/botc-asp) for the **"Scratch on the Smartphone" (SOTS)** use case — a lightweight, mobile-friendly tool for BotC storytellers to track which role distributions remain consistent with what players have learned during the game.

### Why ZDDs?

BotC role distributions are *families of sets* — each valid game setup is a subset of roles chosen from a script. ZDDs are a compact data structure purpose-built for representing and manipulating families of sets:

- **Zero-suppression** naturally handles the sparsity of role distributions (most roles in a script are *not* in any given game).
- **Hash-consing** provides structural sharing, keeping memory usage low.
- **Set-family algebra** (union, intersection, difference, cross-product) maps directly to the operations needed for distribution tracking: "what if we learn role X is in the game?" is just an `onset` operation.

### Relationship to botc-asp

[botc-asp](https://github.com/pnkfelix/botc-asp) encodes BotC game logic using Clingo/ASP. Key files:

- `botc.lp` — core game predicates (role categories, player counts, distribution rules)
- `tb.lp` — Trouble Brewing script definition
- `web-ui/` — PureScript/JS web UI running Clingo in WASM

botc-zdd aims to provide a faster, more lightweight alternative for the specific problem of enumerating and filtering valid role distributions, without requiring a full ASP solver runtime.

## Structure

```
src/
  zdd.ts    — ZDD implementation (unique table, core operations, counting)
  botc.ts   — BotC types, distribution rules, ZDD builder
  index.ts  — public API re-exports
tests/
  zdd.test.ts   — ZDD unit tests
  botc.test.ts  — BotC distribution tests
```

## Getting started

```bash
npm install
npm run build
npm test
```

## ZDD operations

The `ZDD` class provides:

| Operation | Description |
|-----------|-------------|
| `union(p, q)` | Family union: P ∪ Q |
| `intersection(p, q)` | Family intersection: P ∩ Q |
| `difference(p, q)` | Family difference: P \ Q |
| `product(p, q)` | Cross-product (for disjoint variable sets) |
| `onset(f, v)` | Sets containing variable v (with v removed) |
| `offset(f, v)` | Sets not containing variable v |
| `require(f, v)` | Sets containing variable v (v kept) |
| `removeVar(f, v)` | Remove variable v from all sets |
| `count(f)` | Number of sets in the family |
| `enumerate(f)` | List all sets |

## BotC usage

```typescript
import { ZDD, TROUBLE_BREWING, buildDistributionZDD, resolveRoles } from "botc-zdd";

const zdd = new ZDD();
const allDistributions = buildDistributionZDD(zdd, TROUBLE_BREWING, 7);

console.log(zdd.count(allDistributions)); // 5148

// "We know the Empath is in the game" — filter to distributions containing Empath
const empathVar = TROUBLE_BREWING.roles.findIndex(r => r.name === "Empath");
const withEmpath = zdd.require(allDistributions, empathVar);
console.log(zdd.count(withEmpath)); // fewer distributions
```

## License

MIT
