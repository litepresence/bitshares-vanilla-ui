#!/usr/bin/env python3
"""Materialize slice-17 locale dicts from the hand-reviewed en.json master.

Reads vanilla/locales/en.json, applies the ES_OVERRIDES table below (batch-1
keys only, each with per-key provenance per plan ambiguity B), and writes
vanilla/locales/es.json (key-complete) + 8 key-complete English-fallback
stubs (de/fr/it/ja/ko/ru/tr/zh, _meta.untranslated=true, empty allowlist).

Usage: python3 tooling/build_locale_dicts.py [--check]
  --check: verify committed dicts match generator output (dirty on drift).

es scope rule (plan ambiguity B/C): batch-1 keys carry verified Spanish;
every other es value is an en copy NOT in _meta.translated, so t() falls
through to en at runtime -- never an unverified Spanish string on screen.

Provenance codes used in the table:
  B1#1:<section>.<key>  -- bitshares-ui locale-es.json, same concept
  B1#1-part:<...>       -- #1 es supports a substring (e.g. "Nodo" in "Nodo activo")
  B1#1-adj:<...>        -- #1 es adjacent concept, EN differs (second opinion only)
  B2:<file>             -- astro-ui es dict second opinion
  fresh:<rationale>     -- new translation, rationale recorded inline
  REJECT <src> "<val>"  -- #1/#2 candidate deliberately NOT used, with reason
  ident                 -- identifier / proper noun / symbol: same in all languages
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
STUB_CODES = ["de", "fr", "it", "ja", "ko", "ru", "tr", "zh"]

# key -> (es value, provenance). Batch-1 translatable keys ONLY (32);
# identifiers (network/theme names, placeholder, pending/dash, brand) are
# deliberately absent: same in all languages, never translated.
ES_OVERRIDES = {
    "nav.dashboard": ("Tablero", "B1#1:header.dashboard es; EN-delta: #1 EN is 'Portfolio'"),
    "nav.exchange": ("Intercambio", "B1#1:header.exchange es"),
    "nav.account": ("Cuenta", "B1#1:header.account es"),
    "nav.transfer": ("Transferencia", "B1#1-part:transfer.header es 'Detalles de transferencia' (noun); fresh-form"),
    "nav.explorer": ("Explorador", "B1#1:header.explorer es; EN-delta: #1 EN is 'Explore'"),
    "nav.voting": ("Votación", "fresh:standard Spanish; REJECT B1#1:voting.title es 'Voting' (untranslated-stale); 2nd opinion B2:GovernanceActions title es 'Votación'"),
    "nav.settings": ("Configuraciónes", "B1#1:header.settings es verbatim (odd plural spelling kept as #1-verbatim)"),
    "settings.title": ("Configuraciónes", "B1#1:header.settings es verbatim, same as nav.settings"),
    "settings.th_node": ("Nodo", "B1#1-part:settings.active_node es 'Nodo activo'"),
    "settings.th_latency": ("Latencia", "fresh:standard tech term; REJECT B1#1:footer.latency es 'Estado latente' (mistranslation)"),
    "settings.th_status": ("Estado", "B1#1:gateway.status es"),
    "settings.remove": ("Eliminar", "B1#1:account.perm.remove_text es; 2nd opinion B2 'Eliminar'; REJECT B1#1:settings.remove es 'retirar' (case-mismatched, likely stale)"),
    "settings.select": ("Seleccionar", "B2:selectAll/select pattern; REJECT B1#1:registration.select es 'Elige' (register mismatch for a button label)"),
    "settings.selected": ("Seleccionado", "fresh:standard participle (masculine, implied 'nodo')"),
    "settings.probe_all": ("Probar todos", "fresh:standard verb; B1#1:connection.manual_ping es 'Ir a ping nodos' is a different string"),
    "settings.offline": ("Todos los nodos están inaccesibles. Compruebe su conexión e inténtelo de nuevo.", "fresh:no #1 equivalent"),
    "settings.retry": ("Reintentar", "B1#1:app_init.retry es"),
    "settings.add": ("Añadir", "B1#1-part:settings.add_api es 'Añadir nodo'"),
    "settings.err_wss": ("Solo se permiten URLs wss://.", "fresh:no #1 equivalent"),
    "settings.err_dup": ("Nodo ya listado.", "fresh:no #1 equivalent"),
    "settings.theme_label": ("Tema ", "B1#1:settings.themes es 'Tema'; trailing space preserved verbatim"),
    "settings.connecting": ("conectando", "fresh; LOAD-BEARING: settings.js:236 compares the 'down' literal -- Task 2 must compare canonical ids, never translated text"),
    "settings.down": ("caído", "fresh; LOAD-BEARING: same settings.js:236 note as connecting"),
    "shell.menu": ("Menú", "fresh:standard"),
    "shell.badge_initial": ("conectando…", "fresh; consistent with settings.connecting"),
    "shell.not_ported_suffix": (" — aún no portado; registrado en el segmento N", "fresh; 'slice N' literal rendered as 'segmento N'; leading space preserved"),
    "shell.page_not_found": ("Página no encontrada", "fresh; B1#1-adj:page404.page_not_found_title es '404 Pagina no encontrada' (EN differs: '404 page not found')"),
    "shell.unknown_route": ("Ruta desconocida. ", "fresh; trailing space preserved"),
    "shell.go_dashboard": ("Ir al Tablero", "fresh; consistent with nav.dashboard 'Tablero'"),
    "shell.dashboard": ("Tablero", "same source as nav.dashboard"),
    "shell.opening_market": ("Abriendo el mercado… ", "fresh; trailing space preserved"),
    "shell.go_to": ("Ir a ", "fresh; trailing space preserved"),
}


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def nest_set(d, dotted, value):
    node = d
    parts = dotted.split(".")
    for p in parts[:-1]:
        node = node[p]
    node[parts[-1]] = value


def build():
    with open(os.path.join(LOCALES, "en.json"), encoding="utf-8") as f:
        en = json.load(f)
    en_keys = set(flatten(en))
    missing = [k for k in ES_OVERRIDES if k not in en_keys]
    if missing:
        raise SystemExit("override keys missing from en.json: %s" % missing)

    es = copy.deepcopy(en)
    es["_meta"] = {
        "version": 1,
        "untranslated": False,
        "translated": sorted(ES_OVERRIDES),
        "provenance": {k: v[1] for k, v in sorted(ES_OVERRIDES.items())},
    }
    for k, (val, _prov) in ES_OVERRIDES.items():
        nest_set(es, k, val)

    stubs = {}
    for code in STUB_CODES:
        stub = copy.deepcopy(en)
        stub["_meta"] = {"version": 1, "untranslated": True, "translated": []}
        stubs[code] = stub
    return es, stubs


def write_all():
    es, stubs = build()
    with open(os.path.join(LOCALES, "es.json"), "w", encoding="utf-8") as f:
        json.dump(es, f, ensure_ascii=False, indent=2)
        f.write("\n")
    for code, stub in stubs.items():
        with open(os.path.join(LOCALES, code + ".json"), "w", encoding="utf-8") as f:
            json.dump(stub, f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("wrote es.json + %d stubs (%d keys each)" % (
        len(stubs), len(flatten(json.load(open(os.path.join(LOCALES, 'en.json'), encoding='utf-8'))))))


def check_clean():
    es, stubs = build()
    problems = []
    for name, want in [("es.json", es)] + [(c + ".json", stubs[c]) for c in STUB_CODES]:
        path = os.path.join(LOCALES, name)
        try:
            got = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError) as e:
            problems.append("%s: unreadable (%s)" % (name, e))
            continue
        if got != want:
            problems.append("%s: drifted from generator (re-run build_locale_dicts.py)" % name)
    if problems:
        print("\n".join(problems))
        return 1
    print("dicts match generator output")
    return 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check_clean())
    write_all()
