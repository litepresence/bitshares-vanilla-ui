#!/usr/bin/env python3
"""Update all 12 locale files for R18: add help.about_link and help.topic_about-making_* keys."""

import json
import os

LOCALE_DIR = "/workspace/vanilla/locales"
LOCALE_FILES = [
    "de.json", "es.json", "fr.json", "hi.json", "it.json",
    "ja.json", "ko.json", "pt.json", "ru.json", "tr.json", "zh.json"
]

# English defaults for the new keys
NEW_KEYS = {
    "help.about_link": "About this wallet",
    "help.topic_about-making_title": "Making of this wallet",
    "help.topic_about-making_text": "The build story behind this wallet — 413 exchanges across 14 sessions.",
    "help.topic_about-making_body": "# Making of this wallet\nWhat follows is the original build story: every prompt that created this wallet, from \"acquire bitshares-ui\" on 26 September 2026 to the issue-1 fix on 3 October, with the builders' replies — preserved unedited.\nIt records the decisions this wallet stands on: walking away from another React uplift after issue #3583 and its thousand-hour trap, so this wallet depends on nothing with a release cycle; signing every transaction locally like the old wallet instead of outsourcing it; three themes with the classic look as default; numbers in human terms, never raw chain integers; phone-first layouts from the first slice; and fees read from the live chain, never estimated.\n413 exchanges across 14 sessions. Read it as history: this is how the wallet got built.\n# The full dialog archive\nThe complete exchange-by-exchange record lives on the About page (#/about). Expand the \"Full build dialog\" section there to browse all 413 exchanges, filter by keyword, or deep-link to a specific exchange with ?dialog=N."
}

def update_locale_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Update _meta.translated array
    translated = data.get("_meta", {}).get("translated", [])
    
    # Add new keys to translated array in alphabetical order
    new_translated_keys = [
        "help.about_link",
        "help.topic_about-making_body",
        "help.topic_about-making_text",
        "help.topic_about-making_title"
    ]
    
    for key in new_translated_keys:
        if key not in translated:
            # Find insertion point (alphabetical)
            inserted = False
            for i, existing in enumerate(translated):
                if key < existing:
                    translated.insert(i, key)
                    inserted = True
                    break
            if not inserted:
                translated.append(key)
    
    # Update help section translations
    if "help" not in data:
        data["help"] = {}
    
    help_section = data["help"]
    for key, default_value in NEW_KEYS.items():
        # Extract the short key (after "help.")
        short_key = key[5:]  # remove "help."
        if short_key not in help_section:
            help_section[short_key] = default_value
    
    # Write back
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')  # trailing newline
    
    print(f"Updated {filepath}")

def main():
    for fname in LOCALE_FILES:
        filepath = os.path.join(LOCALE_DIR, fname)
        update_locale_file(filepath)
    
    # Also verify en.json has the keys (it should already)
    en_path = os.path.join(LOCALE_DIR, "en.json")
    with open(en_path, 'r', encoding='utf-8') as f:
        en_data = json.load(f)
    
    # Verify all keys present
    for key in NEW_KEYS:
        short_key = key[5:]
        if short_key not in en_data.get("help", {}):
            print(f"WARNING: en.json missing {short_key}")
        else:
            print(f"OK: en.json has {short_key}")
    
    for key in new_translated_keys:
        if key not in en_data.get("_meta", {}).get("translated", []):
            print(f"WARNING: en.json _meta.translated missing {key}")
        else:
            print(f"OK: en.json _meta.translated has {key}")

if __name__ == "__main__":
    main()