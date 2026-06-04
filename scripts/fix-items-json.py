"""Repair items.json: strip C0 control chars inside string literals, then
survey + clean leading garbage characters from each item's `name`.

Some item names ship with a leading icon/control sequence — usually a
form-feed (0x0C) followed by a 3-byte UTF-8 codepoint that the source
data used as a category glyph (Training Link, premium items, etc).
We strip any leading run of non-alphanumeric, non-ASCII-bracket
characters so names start cleanly with a letter, digit, or open paren.

Writes back to data/raw/items.json in place. Backs up to .bak first.
"""

import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS_PATH = ROOT / "data" / "raw" / "items.json"
BACKUP = ITEMS_PATH.with_suffix(".json.bak")


def strip_control_chars_in_strings(raw: str) -> str:
    """Walk the JSON text and strip C0 control bytes (0x00-0x1F except
    TAB/LF/CR) that appear inside string literals — those are illegal in
    JSON and they're how the source data got corrupted to begin with."""
    out = []
    in_str = False
    escape = False
    for c in raw:
        if escape:
            out.append(c)
            escape = False
            continue
        if c == "\\":
            out.append(c)
            escape = True
            continue
        if c == '"':
            out.append(c)
            in_str = not in_str
            continue
        if in_str and ord(c) < 0x20 and c not in "\t\n\r":
            continue   # drop the control byte
        out.append(c)
    return "".join(out)


def clean_name(name: str) -> str:
    """Strip leading non-alphanumeric junk while keeping ASCII opening
    brackets/parens. Returns the cleaned string."""
    return re.sub(r"^[^A-Za-z0-9(\[]+", "", name).strip()


def main() -> None:
    raw = ITEMS_PATH.read_text(encoding="utf-8")
    cleaned_text = strip_control_chars_in_strings(raw)
    items = json.loads(cleaned_text)
    print(f"loaded {len(items)} items")

    # First pass — collect the renames so we can print + write
    # safely. Holding the diff prevents partial state if printing crashes.
    renames = []
    for it in items:
        name = it.get("name")
        if not isinstance(name, str):
            continue
        new_name = clean_name(name)
        if new_name != name:
            renames.append((it["id"], name, new_name))
            it["name"] = new_name

    print(f"renamed {len(renames)} item(s)")
    # Print only the bytes of the stripped prefix (ASCII-safe), not the
    # full names — Windows consoles in cp1252 can't print arbitrary
    # CJK / private-use codepoints.
    print("\nstripped prefixes (first 30):")
    for _id, old, new in renames[:30]:
        # Anything in `old` not in `new` is the leading junk we removed.
        prefix = old[: len(old) - len(new)] if old.endswith(new) else old
        prefix_hex = " ".join(f"{ord(c):02x}" for c in prefix)
        # Use repr-with-ASCII-only fallback to avoid encoder errors on stdout.
        try:
            print(f"  id={_id:>5}  prefix=[{prefix_hex}]  -> {new!r}".encode("ascii", "replace").decode("ascii"))
        except Exception:
            pass

    # Back up the original (only if no backup exists yet — preserves the
    # truly-original file across repeated runs).
    if not BACKUP.exists():
        shutil.copy2(ITEMS_PATH, BACKUP)
        print(f"backup written to {BACKUP.name}")

    ITEMS_PATH.write_text(
        json.dumps(items, indent="\t", ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {ITEMS_PATH}")


if __name__ == "__main__":
    main()
