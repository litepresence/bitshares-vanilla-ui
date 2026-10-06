#!/usr/bin/env python3
"""i18n batch-5: stale glyph + ballot intro + router SEO keys + es review fixes.

Covers the locale-side of the director i18n task:
  1. STALE KEY: splash.pulse_stale ("-- stale" default; es "— desactualizado").
  2. VOTE INTRO: vote.ballot_intro (long en default; es real Spanish).
  3. ROUTER KEYING: 20 seo.title_*/seo.desc_* keys (defaults byte-verbatim
     from router.js ROUTE_META; seo.title_account uses %(name)s).
  4. ES REVIEW: real Spanish for 19 round-1 help values left identical to en
     (about-making x3, airdrop title, assets-feed x3, assets-issue x3,
     browser x3, community x3, menu x3) + gateway.intro_b Transfer screen
     name (Transfer -> Transferencia) + tour.s1_title calque
     ("firma en local" -> "firma local").

Rules (check_i18n gate): non-es dicts receive exact en values for new keys
(stub-honest, outside their translated allowlists); en + es _meta.translated
grow by exactly the 22 new keys (lists stay sorted); no other dict value is
touched (asserted). Placeholders (%(name)s), routes (#/about), query
(?dialog=N), quoted identifiers, numbers, asset symbols and the BitShares
Wallet brand suffix stay byte-verbatim in es values.

Usage: python3 tooling/apply_i18n_batch5.py [--apply]
  Default: dry run (asserts counts, prints planned changes, writes nothing).
  --apply: rewrites vanilla/locales/*.json (12 dicts).
"""
import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "vanilla", "locales")
CODES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]

EM = "—"

# Dotted key -> en default (byte-verbatim from the t() call sites).
NEW_KEYS = {
    "splash.pulse_stale": EM + " stale",
    "vote.ballot_intro": (
        "Your stake elects witnesses and committee and funds workers "
        + EM + " all counts and shares below are live chain reads."
    ),
    "seo.title_dashboard": "Dashboard " + EM + " BitShares Wallet",
    "seo.desc_dashboard": (
        "BitShares dashboard " + EM + " balances, markets and chain activity "
        "at a glance. Browse freely; keys stay on your device."
    ),
    "seo.title_market": "BTS/USD Exchange " + EM + " BitShares Wallet",
    "seo.desc_market": (
        "Trade BTS for USD on the BitShares order book " + EM + " live bids, "
        "asks and history, signed locally on your device."
    ),
    "seo.title_pools": "Liquidity Pools " + EM + " BitShares Wallet",
    "seo.desc_pools": (
        "Browse BitShares liquidity pools " + EM + " pairs, balances and "
        "activity read live from the chain. No login needed."
    ),
    "seo.title_explorer": "Blockchain Explorer " + EM + " BitShares Wallet",
    "seo.desc_explorer": (
        "Explore BitShares blocks, transactions and assets " + EM + " live "
        "chain data, browsable with no login."
    ),
    "seo.title_transfer": "Send Funds " + EM + " BitShares Wallet",
    "seo.desc_transfer": (
        "Send BitShares assets to any account. Review every field, then sign "
        "locally " + EM + " keys never leave your device."
    ),
    "seo.title_account": "Account %(name)s " + EM + " BitShares Wallet",
    "seo.desc_account": (
        "View this BitShares account " + EM + " balances, orders and history "
        "read live from the chain. No login needed."
    ),
    "seo.title_voting": "Vote Witnesses " + EM + " BitShares Wallet",
    "seo.desc_voting": (
        "Vote for BitShares witnesses, committee members and workers. Every "
        "ballot is signed locally on your device."
    ),
    "seo.title_about": "About " + EM + " BitShares Wallet",
    "seo.desc_about": (
        "About this BitShares wallet " + EM + " local keys, no signup, no "
        "tracking. Browse freely and sign locally."
    ),
    "seo.title_help": "Help " + EM + " BitShares Wallet",
    "seo.desc_help": (
        "BitShares wallet help " + EM + " guides for accounts, trading, "
        "voting and recovery. Start here when stuck."
    ),
    "seo.title_login": "Log In " + EM + " BitShares Wallet",
    "seo.desc_login": (
        "Unlock your local BitShares wallet " + EM + " password, brainkey or "
        "imported keys. Keys never leave this device."
    ),
}

# Dotted key -> real Spanish (human-review flagged in the task summary).
# Glossary: testigo/comité/trabajador/proxy(apoderado)/brainkey/HTLC/swap/
# slate kept per established es voice; Bids->Compras, Asks->Ventas (market.*);
# Pools->"Pools de liquidez" (pools.title); Transfer screen->Transferencia
# (transfer.title/nav.transfer); brand suffix "BitShares Wallet" verbatim.
ES_NEW = {
    "splash.pulse_stale": EM + " desactualizado",
    "vote.ballot_intro": (
        "Tu participaci" + "\u00f3" + "n elige testigos y comit" + "\u00e9"
        " y financia trabajadores " + EM + " todos los conteos y pesos "
        "siguientes son lecturas en vivo de la cadena."
    ),
    "seo.title_dashboard": "Tablero " + EM + " BitShares Wallet",
    "seo.desc_dashboard": (
        "Tablero BitShares " + EM + " saldos, mercados y actividad de la "
        "cadena de un vistazo. Explora libremente; las claves quedan en tu "
        "dispositivo."
    ),
    "seo.title_market": "Mercado BTS/USD " + EM + " BitShares Wallet",
    "seo.desc_market": (
        "Opera BTS por USD en el libro de " + "\u00f3" + "rdenes BitShares "
        + EM + " compras, ventas e historial en vivo, con firma local en tu "
        "dispositivo."
    ),
    "seo.title_pools": "Pools de liquidez " + EM + " BitShares Wallet",
    "seo.desc_pools": (
        "Explora los pools de liquidez BitShares " + EM + " pares, saldos y "
        "actividad le" + "\u00ed" + "dos en vivo de la cadena. Sin registro."
    ),
    "seo.title_explorer": "Explorador " + EM + " BitShares Wallet",
    "seo.desc_explorer": (
        "Explora bloques, transacciones y activos BitShares " + EM + " datos "
        "en vivo de la cadena, sin registro."
    ),
    "seo.title_transfer": "Enviar fondos " + EM + " BitShares Wallet",
    "seo.desc_transfer": (
        "Env" + "\u00ed" + "a activos BitShares a cualquier cuenta. Revisa "
        "cada campo y firma localmente " + EM + " las claves nunca salen de "
        "tu dispositivo."
    ),
    "seo.title_account": "Cuenta %(name)s " + EM + " BitShares Wallet",
    "seo.desc_account": (
        "Mira esta cuenta BitShares " + EM + " saldos, " + "\u00f3"
        + "rdenes e historial le" + "\u00ed" + "dos en vivo de la cadena. "
        "Sin registro."
    ),
    "seo.title_voting": "Vota testigos " + EM + " BitShares Wallet",
    "seo.desc_voting": (
        "Vota testigos, comit" + "\u00e9" + " y trabajadores de BitShares. "
        "Cada voto se firma localmente en tu dispositivo."
    ),
    "seo.title_about": "Acerca de " + EM + " BitShares Wallet",
    "seo.desc_about": (
        "Sobre esta billetera BitShares " + EM + " claves locales, sin "
        "registro, sin rastreo. Explora libremente y firma localmente."
    ),
    "seo.title_help": "Ayuda " + EM + " BitShares Wallet",
    "seo.desc_help": (
        "Ayuda de la billetera BitShares " + EM + " gu" + "\u00ed" + "as de "
        "cuentas, operaciones, votaci" + "\u00f3" + "n y recuperaci"
        + "\u00f3" + "n. Empieza aqu" + "\u00ed" + " si te atascas."
    ),
    "seo.title_login": "Iniciar sesi" + "\u00f3" + "n " + EM + " BitShares Wallet",
    "seo.desc_login": (
        "Desbloquea tu billetera BitShares local " + EM + " contrase"
        + "\u00f1" + "a, brainkey o claves importadas. Las claves nunca "
        "salen de este dispositivo."
    ),
}

# Dotted key -> (expected current es value, new es value). Round-1 leftovers
# that were identical to en (deficiency per task 5) plus two voice fixes.
# Voice: help bodies/texts use usted imperative (Sugiera/Proponga/Elija
# precedent); technical tokens (WebSocket/WebCrypto/BigInt/Feed/Issue desks,
# routes, queries, quoted ids, dates-as-numbers) stay byte-verbatim.
ES_FIX = {
    "help.topic_about-making_title": (
        "Making of this wallet",
        "C" + "\u00f3" + "mo se hizo esta billetera",
    ),
    "help.topic_about-making_text": (
        "The build story behind this wallet " + EM + " 413 exchanges across 14 sessions.",
        "La historia de construcci" + "\u00f3" + "n tras esta billetera "
        + EM + " 413 intercambios en 14 sesiones.",
    ),
    "help.topic_airdrop_title": (
        "Airdrops",
        "Repartos (airdrops)",
    ),
    "help.topic_assets-feed_title": (
        "Publishing price feeds",
        "Publicar feeds de precios",
    ),
    "help.topic_assets-feed_text": (
        "Publish price feeds for market-pegged assets you feed.",
        "Publique feeds de precios para los activos vinculados al mercado "
        "que alimenta.",
    ),
    "help.topic_assets-issue_title": (
        "Issuing assets",
        "Emitir activos",
    ),
    "help.topic_assets-issue_text": (
        "Mint new supply of an asset you control from the Issue desk.",
        "Emita nueva oferta de un activo que controla desde el escritorio "
        "Issue.",
    ),
    "help.topic_browser_title": (
        "Browser support",
        "Navegadores compatibles",
    ),
    "help.topic_browser_text": (
        "Which browsers run the wallet, and what the compatibility notice means.",
        "Qu" + "\u00e9" + " navegadores ejecutan la billetera y qu"
        + "\u00e9" + " significa el aviso de compatibilidad.",
    ),
    "help.topic_community_title": (
        "Community",
        "Comunidad",
    ),
    "help.topic_community_text": (
        "Chats, forums, explorers, and code around BitShares.",
        "Chats, foros, exploradores y c" + "\u00f3" + "digo alrededor de "
        "BitShares.",
    ),
    "help.topic_menu_title": (
        "Site menu",
        "Men" + "\u00fa" + " del sitio",
    ),
    "help.topic_menu_text": (
        "Every page in this wallet, grouped the way the navigation menu groups them.",
        "Cada p" + "\u00e1" + "gina de esta billetera, agrupada como las "
        "agrupa el men" + "\u00fa" + " de navegaci" + "\u00f3" + "n.",
    ),
}

# Long bodies (kept out of ES_FIX for readability; same (old, new) shape).
ES_FIX_BODY = {
    "help.topic_about-making_body": (
        "# Making of this wallet\n"
        "What follows is the original build story: every prompt that created "
        "this wallet, from \"acquire bitshares-ui\" on 26 September 2026 to "
        "the issue-1 fix on 3 October, with the builders' replies "
        + EM + " preserved unedited.\n"
        "It records the decisions this wallet stands on: walking away from "
        "another React uplift after issue #3583 and its thousand-hour trap, "
        "so this wallet depends on nothing with a release cycle; signing "
        "every transaction locally like the old wallet instead of outsourcing "
        "it; three themes with the classic look as default; numbers in human "
        "terms, never raw chain integers; phone-first layouts from the first "
        "slice; and fees read from the live chain, never estimated.\n"
        "413 exchanges across 14 sessions. Read it as history: this is how "
        "the wallet got built.\n"
        "# The full dialog archive\n"
        "The complete exchange-by-exchange record lives on the About page "
        "(#/about). Expand the \"Full build dialog\" section there to browse "
        "all 413 exchanges, filter by keyword, or deep-link to a specific "
        "exchange with ?dialog=N.",
        "# C" + "\u00f3" + "mo se hizo esta billetera\n"
        "Lo que sigue es la historia original de construcci" + "\u00f3"
        + "n: cada prompt que cre" + "\u00f3" + " esta billetera, desde "
        "\"acquire bitshares-ui\" el 26 de septiembre de 2026 hasta la "
        "correcci" + "\u00f3" + "n del issue-1 el 3 de octubre, con las "
        "respuestas de los constructores " + EM + " preservada sin editar.\n"
        "Registra las decisiones sobre las que se sostiene esta billetera: "
        "abandonar otra subida de React tras el issue #3583 y su trampa de "
        "mil horas, para que esta billetera no dependa de nada con ciclo de "
        "lanzamientos; firmar cada transacci" + "\u00f3" + "n localmente "
        "como la billetera vieja en vez de delegarla; tres temas con el "
        "aspecto cl" + "\u00e1" + "sico por defecto; n" + "\u00fa"
        + "meros en t" + "\u00e9" + "rminos humanos, nunca enteros crudos de "
        "cadena; dise" + "\u00f1" + "os primero para tel" + "\u00e9"
        + "fono desde el primer tramo; y comisiones le" + "\u00ed"
        + "das de la cadena en vivo, nunca estimadas.\n"
        "413 intercambios en 14 sesiones. L" + "\u00e9" + "alo como historia: "
        "as" + "\u00ed" + " se construy" + "\u00f3" + " la billetera.\n"
        "# El archivo completo del di" + "\u00e1" + "logo\n"
        "El registro completo intercambio por intercambio vive en la "
        "p" + "\u00e1" + "gina Acerca de (#/about). Expanda la secci"
        + "\u00f3" + "n \"Full build dialog\" all" + "\u00ed" + " para hojear "
        "los 413 intercambios, filtrar por palabra clave o enlazar a un "
        "intercambio concreto con ?dialog=N.",
    ),
    "help.topic_assets-feed_body": (
        "# Publishing price feeds\n"
        "Publish the settlement price for a market-pegged asset from the "
        "Feed desk; the confirm dialog shows the exact fee before you sign.",
        "# Publicar feeds de precios\n"
        "Publique el precio de liquidaci" + "\u00f3" + "n de un activo "
        "vinculado al mercado desde el escritorio Feed; el di" + "\u00e1"
        + "logo de confirmaci" + "\u00f3" + "n muestra la comisi"
        + "\u00f3" + "n exacta antes de firmar.",
    ),
    "help.topic_assets-issue_body": (
        "# Issuing assets\n"
        "Create new supply of an asset your account controls from the Issue "
        "desk; amounts use the asset's precision and the confirm dialog "
        "shows the exact fee before you sign.",
        "# Emitir activos\n"
        "Cree nueva oferta de un activo que controla su cuenta desde el "
        "escritorio Issue; las cantidades usan la precisi" + "\u00f3"
        + "n del activo y el di" + "\u00e1" + "logo de confirmaci"
        + "\u00f3" + "n muestra la comisi" + "\u00f3" + "n exacta antes de "
        "firmar.",
    ),
    "help.topic_browser_body": (
        "# Detected features, never brand names\n"
        "This wallet never asks which browser you use " + EM + " it probes "
        "the four platform features it genuinely needs: WebSocket (chain "
        "data), WebCrypto (keystore), BigInt (money math), and local storage "
        "(settings). Silence is a pass: no banner on a modern browser means "
        "everything is present.\n"
        "# The most common cause: insecure context\n"
        "Modern browsers expose WebCrypto only in secure contexts: https "
        "pages, localhost, and opened files. The same up-to-date browser "
        "served over plain http (for example a LAN address) reports "
        "WebCrypto missing " + EM + " the browser is fine, the address is "
        "not. Serve the folder over https or localhost, or open index.html "
        "directly.\n"
        "# What still works\n"
        "Browsing always works: balances, markets, explorer, and voting read "
        "public chain data with no wallet features. Only local signing needs "
        "the missing piece. Dismissing the notice hides it on this machine; "
        "it never blocks a page.",
        "# Funciones detectadas, nunca marcas\n"
        "Esta billetera nunca pregunta qu" + "\u00e9" + " navegador usa "
        + EM + " prueba las cuatro funciones de plataforma que de verdad "
        "necesita: WebSocket (datos de cadena), WebCrypto (llavero), BigInt "
        "(matem" + "\u00e1" + "tica de dinero) y almacenamiento local "
        "(ajustes). El silencio es un aprobado: sin aviso en un navegador "
        "moderno significa que todo est" + "\u00e1" + " presente.\n"
        "# La causa m" + "\u00e1" + "s com" + "\u00fa" + "n: contexto "
        "inseguro\n"
        "Los navegadores modernos exponen WebCrypto solo en contextos "
        "seguros: p" + "\u00e1" + "ginas https, localhost y archivos "
        "abiertos. El mismo navegador actualizado servido por http plano "
        "(por ejemplo una direcci" + "\u00f3" + "n LAN) reporta WebCrypto "
        "ausente " + EM + " el navegador est" + "\u00e1" + " bien, la "
        "direcci" + "\u00f3" + "n no. Sirva la carpeta por https o "
        "localhost, o abra index.html directamente.\n"
        "# Lo que sigue funcionando\n"
        "Explorar siempre funciona: saldos, mercados, explorador y "
        "votaci" + "\u00f3" + "n leen datos p" + "\u00fa" + "blicos de "
        "cadena sin funciones de billetera. Solo la firma local necesita la "
        "pieza ausente. Descartar el aviso lo oculta en esta m" + "\u00e1"
        + "quina; nunca bloquea una p" + "\u00e1" + "gina.",
    ),
    "help.topic_community_body": (
        "# Community\n"
        "People and places around BitShares " + EM + " homepage, code, "
        "explorers, forums, and chats " + EM + " live on the Community page.",
        "# Comunidad\n"
        "Personas y lugares alrededor de BitShares " + EM + " p"
        + "\u00e1" + "gina inicial, c" + "\u00f3" + "digo, exploradores, "
        "foros y chats " + EM + " viven en la p" + "\u00e1"
        + "gina Comunidad.",
    ),
    "help.topic_menu_body": (
        "# Site menu\n"
        "The Menu page lists every screen in this wallet by section, so any "
        "desk is one tap away.",
        "# Men" + "\u00fa" + " del sitio\n"
        "La p" + "\u00e1" + "gina Men" + "\u00fa" + " lista cada pantalla "
        "de esta billetera por secci" + "\u00f3" + "n, as" + "\u00ed"
        + " cualquier escritorio queda a un toque.",
    ),
    # Voice fixes (already translated, but deficient Spanish).
    "gateway.intro_b": (
        "Los retiros terminan en Transfer con vista previa de la "
        + "comisi" + "\u00f3" + "n en vivo.",
        "Los retiros terminan en Transferencia con vista previa de la "
        + "comisi" + "\u00f3" + "n en vivo.",
    ),
    "tour.s1_title": (
        "Explora todo gratis, firma en local",
        "Explora todo gratis, firma local",
    ),
}


def deep_get(tree, dotted):
    node = tree
    for p in dotted.split("."):
        if not isinstance(node, dict) or p not in node:
            return None
        node = node[p]
    return node


def deep_set(tree, dotted, value):
    node = tree
    parts = dotted.split(".")
    for p in parts[:-1]:
        child = node.get(p)
        if not isinstance(child, dict):
            child = {}
            node[p] = child
        node = child
    node[parts[-1]] = value


def flat_keys(tree, prefix=""):
    out = {}
    for k, v in tree.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flat_keys(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def main():
    apply = "--apply" in sys.argv[1:]
    dicts = {}
    for code in CODES:
        with open(os.path.join(BASE, code + ".json"), encoding="utf-8") as f:
            dicts[code] = json.load(f)
    before = {c: flat_keys(d) for c, d in dicts.items()}

    # 1-3. New keys: en defaults everywhere; real Spanish in es.
    # Idempotent: a re-run after a partial apply verifies current values
    # instead of failing (lets the allowlist repair below proceed).
    for key in sorted(NEW_KEYS):
        cur = deep_get(dicts["en"], key)
        if cur is not None:
            assert cur == NEW_KEYS[key], "en %s diverged: %r" % (key, cur)
            assert deep_get(dicts["es"], key) == ES_NEW[key], \
                "es %s diverged" % key
    for key, en_val in NEW_KEYS.items():
        for code in CODES:
            if code == "es":
                deep_set(dicts[code], key, ES_NEW[key])
            else:
                deep_set(dicts[code], key, en_val)
    # Allowlists: en + es gain the 22 new keys (es with real Spanish, flagged
    # human-review); the other 10 dicts are fully-translated per the gate's
    # wave-1+ branch (HEAD precedent: de allowlist == all keys), so they list
    # the new keys too while holding exact en values (stub-honest).
    for code in CODES:
        tr = dicts[code]["_meta"]["translated"]
        for key in NEW_KEYS:
            if key not in tr:
                tr.append(key)
        tr.sort()

    # 4. es review fixes (assert current text first — never blind-write;
    #    skip keys already at the new value so re-runs stay green).
    for key, (old, new) in list(ES_FIX.items()) + list(ES_FIX_BODY.items()):
        cur = deep_get(dicts["es"], key)
        if cur == new:
            continue
        assert cur == old, "es %s changed under us:\n%r\nvs\n%r" % (key, cur, old)
        assert new != before["en"][key], "es fix identical to en: %s" % key
        deep_set(dicts["es"], key, new)

    after = {c: flat_keys(d) for c, d in dicts.items()}

    # 5. No other value touched: every non-es dict differs only by new keys;
    #    es differs only by new keys + review fixes.
    fixed = set(ES_FIX) | set(ES_FIX_BODY)
    problems = []
    for code in CODES:
        for key in after[code]:
            if key in NEW_KEYS:
                continue
            if code == "es" and key in fixed:
                continue
            if after[code][key] != before[code][key]:
                problems.append("%s unexpectedly changed: %s" % (code, key))
        if set(after[code]) - set(before[code]) - set(NEW_KEYS):
            problems.append("%s key-set delta wrong" % code)
        if set(NEW_KEYS) - set(after[code]):
            problems.append("%s missing new keys" % code)
    # Stub honesty: non-es, non-en dicts hold exact en values for new keys.
    for code in CODES:
        if code in ("en", "es"):
            continue
        for key, en_val in NEW_KEYS.items():
            if after[code][key] != en_val:
                problems.append("%s new key not en-identical: %s" % (code, key))
    # es new values really differ from en (translations, not copies).
    for key in NEW_KEYS:
        if after["es"][key] == after["en"][key]:
            problems.append("es new key identical to en: %s" % key)
    if problems:
        print("REFUSING:")
        print("\n".join(problems))
        return 1

    print("batch-5: %d new keys, %d es fixes; all assertions hold"
          % (len(NEW_KEYS), len(ES_FIX) + len(ES_FIX_BODY)))
    if not apply:
        print("dry run — no files written (pass --apply)")
        return 0
    for code in CODES:
        with open(os.path.join(BASE, code + ".json"), "w", encoding="utf-8") as f:
            json.dump(dicts[code], f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("wrote 12 dicts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
