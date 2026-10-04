#!/usr/bin/env python3
"""
Migrate all remaining local `touchable` functions to the shared utility
and add appropriate button variant classes.

Rules:
- Primary actions (Sign, Send, Propose, Confirm, Add, Create, Unlock, Retry, 
  Look up, Open, View, Reset, Regenerate, Register, Review, List, Borrow,
  Redeem, Extend, Accept, Vote, Propose, Approve, Unapprove, Delete,
  Refresh, Look up, Load deeper history) → Primary (base button, no class)
- Back, Cancel, Keep, Close, Dismiss → .btn-ghost
- Tabs, pagers, inline, icon-only, toast-x, raw summary → .subtle-btn
- Links (anchors) → no class change (they use a.btn / a.btn-ghost in CSS)
- Simple touch floor only (inputs, checkboxes, radios, summary, labels) → 
  use .touchable class or global touchable() call
"""

import re
import os
from pathlib import Path

# Files to process (from grep results)
FILES = [
    "vanilla/js/views/htlc-ui.js",
    "vanilla/js/views/api-lab-ui.js",
    "vanilla/js/views/ops-ui.js",
    "vanilla/js/views/transfer-ui.js",
    "vanilla/js/views/market-ind.js",
    "vanilla/js/views/explorer-blocks.js",
    "vanilla/js/views/favourites-ui.js",
    "vanilla/js/views/borrow-ui.js",
    "vanilla/js/views/wallet-ui.js",
    "vanilla/js/views/market-desk.js",
    "vanilla/js/views/prediction-ui.js",
    "vanilla/js/views/explorer-assets.js",
    "vanilla/js/views/explorer-ui.js",
    "vanilla/js/views/trade-form.js",
    "vanilla/js/views/es-lab-ui.js",
    "vanilla/js/views/trollbox-ui.js",
    "vanilla/js/views/gateway-ui.js",
    "vanilla/js/views/referrals-ui.js",
    "vanilla/js/views/credit-ui.js",
    "vanilla/js/views/vote-slate.js",
    "vanilla/js/views/market-picker.js",
    "vanilla/js/views/explorer-render.js",
    "vanilla/js/views/create-account-ui.js",
    "vanilla/js/views/fees-ui.js",
    "vanilla/js/views/password-ui.js",
    "vanilla/js/views/proposal-ui.js",
]

# Button text patterns for classification
PRIMARY_PATTERNS = [
    r"Sign\s*&\s*Send", r"Sign and Send", r"Sign\s+&\s+Send",
    r"\bSend\b", r"\bPropose\b", r"\bConfirm\b", r"\bAdd\b", r"\bCreate\b",
    r"\bUnlock\b", r"\bRetry\b", r"Look\s*up", r"Look\s*Up",
    r"\bOpen\b", r"\bView\b", r"\bReset\b", r"\bRegenerate\b", r"\bRegister\b",
    r"\bReview\b", r"\bList\b", r"\bBorrow\b", r"\bRedeem\b", r"\bExtend\b",
    r"\bAccept\b", r"\bVote\b", r"\bApprove\b", r"\bUnapprove\b", r"\bDelete\b",
    r"\bRefresh\b", r"Load\s+deeper", r"\bSave\b", r"\bSubmit\b",
    r"\bContinue\b", r"\bNext\b", r"\bFinish\b", r"\bDone\b",
    r"\bPublish\b", r"\bBroadcast\b", r"\bExecute\b",
    r"Unlock\s*&\s*review", r"Unlock\s*&\s*review",
]

GHOST_PATTERNS = [
    r"\bBack\b", r"\bCancel\b", r"\bKeep\b", r"\bClose\b", r"\bDismiss\b",
    r"Remove\b", r"Clear\b", r"\bDiscard\b", r"\bReject\b", r"\bNo\b",
]

SUBTLE_PATTERNS = [
    r"\btab\b", r"pager", r"page", r"icon", r"toast", r"summary",
    r"Recent\s+trades", r"My\s+trades", r"\bRecent\b", r"\bMy\b",
    r"Buy\s*$", r"Sell\s*$", r"Scaled\s*$",
]

# Special button IDs that indicate type
PRIMARY_IDS = [
    "trade-review", "unlock-and-review", "sign-send", "send-btn",
    "review-btn", "create-btn", "add-btn", "propose-btn",
]

GHOST_IDS = [
    "back-btn", "cancel-btn", "close-btn", "dismiss-btn",
    "remove-btn", "clear-btn",
]

SUBTLE_IDS = [
    "trade-tab-buy", "trade-tab-scaled", "trade-tab-sell",
    "mkt-trades-tab-recent", "mkt-trades-tab-my",
    "mkt-tabs", "trade-tabs", "order-tabs",
    "pools-pager", "mkt-quotes", "mkt-scalerow", "mkt-indmenu",
    "mkt-star", "mkt-bell", "toast-x",
    "xplore-tab", "xplore-suggest-row",
]

def classify_button(text, btn_id="", btn_class="", tag="button"):
    """Classify a button based on its text, id, class, and tag."""
    text_lower = text.lower().strip()
    
    # Check explicit IDs first
    for pid in PRIMARY_IDS:
        if pid in btn_id:
            return "primary"
    for gid in GHOST_IDS:
        if gid in btn_id:
            return "ghost"
    for sid in SUBTLE_IDS:
        if sid in btn_id:
            return "subtle"
    
    # Check classes
    if "xplore-tab" in btn_class or "xplore-suggest-row" in btn_class:
        return "subtle"
    if "trade-tabs" in btn_class or "order-tabs" in btn_class or "mkt-tabs" in btn_class:
        return "subtle"
    if "mkt-star" in btn_class or "mkt-bell" in btn_class or "toast-x" in btn_class:
        return "subtle"
    
    # Check text patterns
    for pattern in PRIMARY_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return "primary"
    for pattern in GHOST_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return "ghost"
    for pattern in SUBTLE_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return "subtle"
    
    # Default: if it's a <button> without clear classification, 
    # check if it looks like a tab/pager
    if tag == "button":
        # Very short text often = tab/pager
        if len(text_lower) <= 10 and not any(c.isdigit() for c in text_lower):
            return "subtle"
        return "primary"
    
    return "none"


def process_file(filepath):
    """Process a single file: remove local touchable, update button calls."""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Remove the local touchable function definition
    # Pattern: function touchable(n) { ... }
    content = re.sub(
        r'\n\s*function touchable\(n\)\s*\{[^}]*\}\s*',
        '\n',
        content
    )
    content = re.sub(
        r'\n\s*function touchable\(n\)\s*\{[^}]*try\s*\{[^}]*\}\s*catch\s*\(e\)\s*\{[^}]*\}\s*return n;\s*\}\s*',
        '\n',
        content
    )
    # Also handle the simpler version
    content = re.sub(
        r'function touchable\(n\)\s*\{[^}]*return n;\s*\}\s*',
        '',
        content
    )
    
    # 2. Replace touchable(el(doc, "button", ...)) calls
    # We need to find all touchable(el(doc, "button", ...)) and add class
    def replace_button_call(match):
        full = match.group(0)
        # Extract the button text
        text_match = re.search(r'el\(doc,\s*"button",\s*"([^"]*)"', full)
        if not text_match:
            text_match = re.search(r'el\(doc,\s*"button",\s*`([^`]*)`', full)
        if not text_match:
            # Could be a variable
            return full
        
        text = text_match.group(1)
        
        # Extract id if present
        id_match = re.search(r'\.id\s*=\s*"([^"]*)"', full)
        btn_id = id_match.group(1) if id_match else ""
        
        # Classify
        cls = classify_button(text, btn_id=btn_id)
        
        # Add class to the el() call
        if cls == "ghost":
            # Modify the el() call to include class
            return full.replace('el(doc, "button", "', f'el(doc, "button", "').replace('")', '", "btn-ghost")')
        elif cls == "subtle":
            return full.replace('el(doc, "button", "', f'el(doc, "button", "').replace('")', '", "subtle-btn")')
        else:
            # Primary - no extra class needed
            return full
    
    # Pattern for touchable(el(doc, "button", ...))
    content = re.sub(
        r'touchable\(el\(doc,\s*"button",\s*"[^"]*"[^)]*\)\)',
        replace_button_call,
        content
    )
    
    # Also handle template literals
    content = re.sub(
        r'touchable\(el\(doc,\s*"button",\s*`[^`]*`[^)]*\)\)',
        replace_button_call,
        content
    )
    
    # 3. Handle touchable on <a> (anchor) elements - these use a.btn / a.btn-ghost in CSS
    def replace_anchor_call(match):
        full = match.group(0)
        text_match = re.search(r'el\(doc,\s*"a",\s*"([^"]*)"', full)
        if not text_match:
            return full
        text = text_match.group(1)
        
        id_match = re.search(r'\.id\s*=\s*"([^"]*)"', full)
        btn_id = id_match.group(1) if id_match else ""
        
        cls = classify_button(text, btn_id=btn_id, tag="a")
        
        if cls == "ghost":
            return full.replace('el(doc, "a", "', 'el(doc, "a", "').replace('")', '", "btn-ghost")')
        elif cls == "subtle":
            return full.replace('el(doc, "a", "', 'el(doc, "a", "').replace('")', '", "subtle-btn")')
        else:
            return full
    
    content = re.sub(
        r'touchable\(el\(doc,\s*"a",\s*"[^"]*"[^)]*\)\)',
        replace_anchor_call,
        content
    )
    
    # 4. Handle touchable on other elements (inputs, selects, summary, etc.)
    # These should just use the global touchable() - keep the call but 
    # they'll use the global window.touchable
    # Actually, the global touchable is already exposed on window, so calls work
    # But we should also add .touchable class for CSS fallback
    def replace_other_call(match):
        full = match.group(0)
        # Extract tag
        tag_match = re.search(r'el\(doc,\s*"([^"]+)"', full)
        if not tag_match:
            return full
        tag = tag_match.group(1)
        
        if tag in ("input", "select", "summary", "label"):
            # Add .touchable class for CSS fallback
            return full.replace(f'el(doc, "{tag}", ', f'el(doc, "{tag}", ').replace('")', '", "touchable")')
        
        return full
    
    content = re.sub(
        r'touchable\(el\(doc,\s*"(input|select|summary|label)",\s*"[^"]*"[^)]*\)\)',
        replace_other_call,
        content
    )
    
    # 5. Handle standalone touchable(el(doc.createElement(...))) calls
    def replace_create_element_call(match):
        full = match.group(0)
        # Check what element is being created
        if 'createElement("button")' in full:
            # Try to find text content set later - hard to do statically
            # For now, keep as touchable() call (global will handle it)
            return full.replace('touchable(', 'touchable(')
        elif 'createElement("a")' in full:
            return full.replace('touchable(', 'touchable(')
        else:
            return full.replace('touchable(', 'touchable(')
    
    content = re.sub(
        r'touchable\(doc\.createElement\([^)]+\)\)',
        replace_create_element_call,
        content
    )
    
    # 6. Handle touchable on raw element variables (e.g., touchable(sel), touchable(inp))
    # These are fine - global touchable will handle them
    
    # 7. Add import comment if not present (but we don't use imports in this codebase)
    # The global touchable is exposed on window.touchable
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False


def main():
    changed = 0
    for f in FILES:
        full = Path("/workspace") / f
        if full.exists():
            if process_file(str(full)):
                print(f"Updated: {f}")
                changed += 1
            else:
                print(f"No changes: {f}")
        else:
            print(f"NOT FOUND: {f}")
    print(f"\nTotal files changed: {changed}")


if __name__ == "__main__":
    main()