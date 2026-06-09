# Vendored: PokéMMO damage engine

This folder is a **vendored copy** of the damage-calculation engine from:

- **c4vv/pokemmo-damage-calc** — https://github.com/c4vv/pokemmo-damage-calc
  (a PokéMMO-specific fork of the Smogon damage calculator)

which is itself derived from:

- **@smogon/calc** — https://github.com/smogon/damage-calc — MIT License

Only the calculation engine (`calc/*.js`, the CommonJS build) is vendored here —
the source maps, `.d.ts`, the minified bundle, and the original jQuery UI were
dropped. The PokéMMO-specific mechanics and data (Gen 5/6 base with 1.5× crit,
Snowscape, Sharpness / Neutralizing Gas, base-stat and move-power adjustments,
etc.) are baked into this engine.

The upstream `@smogon/calc` is MIT licensed. The c4vv fork does not ship an
explicit license file; this copy is included in good faith for a non-commercial
PokéMMO fan tool, with credit to both projects. If either maintainer objects,
it will be removed.
