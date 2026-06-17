# Features

This is a plain-language guide to what PokéMMO Tools actually does today, tab by
tab. It is **not** a list of everything — it's a focused map of *what's already
built* and *what we'd work on next*, so we can finish one thing at a time instead
of spreading effort across a dozen half-done ideas.

Each tab has two parts:

- **Details** — what the feature is and everything it can do right now.
- **TODO** — things we might add to it later.

We'll add tabs to this file one at a time. Starting with the Pokédex.

---

## Pokédex

The Pokédex is the home tab — the first thing you see when you open the app. It's
the master list of every Pokémon in the game, and it doubles as the search tool.
(There used to be separate "Search" and "Moves" tabs; everything they did now
lives here, so there's just one place to look things up.)

### Details

**Browsing the list**

- By default it shows every Pokémon. You don't have to search or filter for
  anything to appear — the full list is right there.
- You can switch to a single region (Kanto, Johto, Hoenn, Sinnoh, or Unova). When
  you do, the list narrows to just the Pokémon found in that region and numbers
  them by that region's order instead of the National Dex.
- You can view the list as a **grid** of cards (lots of Pokémon at a glance) or as
  a compact **list** of rows. The grid fits more on wide screens.
- A running count always shows how many Pokémon match what you're looking at.
- A **Settings** menu in the top bar (the gear) controls two app-wide looks at
  once: the light or dark theme, and whether Pokémon show as modern 3D renders or
  classic pixel-art sprites. Your choice carries across every tab.

**Searching**

- Type a name to find a Pokémon — partial spelling works, so "char" finds
  Charmander, Charmeleon, and Charizard.
- Type a number to jump straight to that dex number. If you've picked a region,
  the number matches that region's dex; otherwise it matches the National Dex.

**Sorting**

- Sort the list by dex number (the default), alphabetically by name, or by
  overall strength (total base stats, strongest first).

**Advanced filters**

There's a **Filters** button that opens a side panel with deeper search options.
A little number on the button tells you how many advanced filters are switched on.
You can combine as many of these as you like:

- **Types** — narrow to one or more types (Fire, Water, Flying, and so on), with a
  toggle for "must have **all** the types I picked" (for example, Water *and*
  Flying) or "has **any** of them" (Water *or* Flying). *(This used to also sit in
  the main toolbar; it now lives here only, so there's one place to pick types.)*
- **Moves** — pick up to four moves and find every Pokémon that can learn them,
  with the same "all of them" / "any of them" toggle. When you filter by moves,
  each Pokémon card also shows *how* it learns the move (by leveling up, from a TM,
  a tutor, an egg, or on evolution).
- **Ability** — show only Pokémon that have a specific ability.
- **Held item** — show only Pokémon that can be found holding a particular item in
  the wild.
- **Egg groups** — filter by breeding egg group, again with an all/any toggle.
- **Base stats** — sliders let you set a minimum and maximum for any stat (HP,
  Attack, Defense, Special Attack, Special Defense, Speed) and for the overall
  total.

Every filter you turn on appears as a little removable tag above the results, so
you can always see what's being applied and clear any of them with one tap.

**The detail popup**

Click any Pokémon and a detailed popup opens with everything about it. To keep it
from getting too long, the heavier sections are tucked into collapsible panels you
expand only when you want them:

- A large picture, its dex number, name, and types — plus badges for special
  status (Legendary, Mythical, Baby) and its competitive and shiny rarity tiers.
  A **Show shiny** button flips to the shiny look when one exists.
- A compact **profile** right in the title banner: height, weight, how hard it is
  to catch, how fast it levels up, its egg groups, and its male/female ratio shown
  as a split bar.
- **Base stats** shown as bars, with the total.
- Its **abilities**, each with a plain-English description, and hidden abilities
  clearly marked.
- The full **evolution family** drawn as a centered tree, including how each
  evolution happens. You can click any relative to jump straight to it.
- A built-in **catch calculator** *(collapsible)*: set the battle conditions (the
  Pokémon's remaining HP, status, time of day, your catch streak, and more) and it
  ranks the Poké Balls by how likely each one is to catch — no separate tool
  needed.
- Its **moves** *(collapsible)*, organized into tabs for level-up, TM, tutor, and
  egg moves. Each move lists its type, category, power, accuracy, and PP, and you
  can tap a move to read what it does.
- Any **items it can be holding in the wild** *(collapsible)*, with the chance and
  a description.
- Every **place you can catch it** *(collapsible)*, grouped by region, with the
  method, level range, time of day, and how rare the encounter is.

### TODO

- **Side-by-side compare** — pick two or more Pokémon and view their stats, types,
  and movepools next to each other.
- **Act on a Pokémon without leaving the Pokédex** — add it to your Box, a team,
  or the catch Tracker right from the card or the detail popup (today the popup
  only links out to the Catch Calculator).
- **Jump to the map** — a button in the detail popup's encounter list that opens
  the interactive Maps tab at that location.
- **Show EV yield** — the detail popup lists most of a Pokémon's profile, but not
  what EVs it gives when defeated; add that for EV trainers.
- **More ways to filter** — by special status (Legendary/Mythical), competitive or
  shiny tier, or growth rate.
- **Sort by a single stat** — for example, list everything by Speed, not just by
  the overall total.
- **Save and share searches** — remember a favorite filter combination, or hand
  someone a link that opens the same filtered view.
