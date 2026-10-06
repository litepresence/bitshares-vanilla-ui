#!/usr/bin/env python3
"""Apply the marketing-copy wave to all 12 locale dicts (values only).

Task: marketing copy + dashboard behavior. Every default change below mirrors
an already-landed t() default in vanilla/js/views/*.js (dashboard/about/htlc/
tour + disclosed 3-line sync in news-ui.js and gateway-ui.js). Key set is
UNCHANGED — this script mutates values only and asserts that.

Rules honored:
  - en dicts take NEW_EN verbatim (= the t() defaults in JS).
  - es dicts take real Spanish (ES table, flagged for human review).
  - All other dicts take the new English value (stub-honest: English until a
    human verifies; never machine-translated into "verified").
  - Placeholders/URLs/IDs/symbols byte-verbatim (asserted: any %()s in the
    old value must survive unchanged in the new one).

Usage: python3 tooling/apply_marketing_copy.py  (from /workspace)
Then:  python3 tooling/check_i18n.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
CODES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]

# flatkey -> new English default (byte-identical to the t() defaults in JS).
NEW_EN = {
    "splash.hero_title": "BitShares wallet in your browser \u2014 nothing to install.",
    "splash.hero_sub": "Your keys. Your funds, on-chain.",
    "splash.hero_sub2": "Browse markets free. Unlock only to sign.",
    "splash.cta_exchange": "Trade on the exchange",
    "dashboard.welcome": "Trade BTS with keys you hold",
    "dashboard.tagline": "Browse markets free \u2014 create a wallet to trade.",
    "splash.pulse_title": "Live chain numbers",
    "splash.pulse_time": "Head time",
    "splash.topvol_unavailable": "Top-market volume is offline \u2014 check Settings \u2192 Nodes.",
    "splash.cards_title": "Trade, pool, explore \u2014 start here",
    "splash.card_dex_d": "Buy and sell on the open market.",
    "splash.card_pool_d": "Earn a cut by pooling two assets.",
    "splash.card_explore_d": "Read blocks and account history.",
    "splash.card_wallet_d": "Hold keys on this device only.",
    "splash.trust_keys_d": "Signing happens locally on your device. No server ever sees a password or a key.",
    "splash.step1_t": "Look around",
    "splash.step1_d": "No login needed \u2014 browse the chain first.",
    "splash.step2_t": "Create a wallet",
    "splash.step2_d": "A brainkey is generated on this device. Write it on paper.",
    "splash.step3_t": "Trade / pool / vote",
    "splash.step3_d": "Limit orders, liquidity pools, and ballots \u2014 all on-chain.",
    "tour.s1_title": "Browse everything free, sign locally",
    "tour.s1_body": "Every page reads public chain data with no login. Open a market to start \u2014 your password is asked only at signing.",
    "tour.s3_title": "See live price charts",
    "tour.s3_body": "Price candles, volume, and depth plus the indicators menu: overlays like SMA and EMA, oscillators like RSI, MACD, and Stochastic. Open the exchange to see it live.",
    "tour.s4_title": "Practice buying and selling",
    "tour.s4_body": "The Buy and Sell panels accept any numbers for practice. Nothing leaves your machine until you review and sign with an unlocked wallet. Open the exchange to try it.",
    "about.hero_lede": "A wallet for the BitShares blockchain \u2014 markets, accounts, governance, and exploration \u2014 running as plain web files. No framework, no installer, no account with us. Your keys never leave this browser.",
    "about.s2_title": "Trade on the real order book",
    "about.s3_title": "Runs for years with no updates",
    "about.s3_body": "The wallet it replaces died under a hundred stale packages and a toolchain nobody can reproduce. Built to avoid release-cycle dependencies: no framework, no package manager, no build step \u2014 the smallest thing that can still run in a browser a decade from now.",
    "about.s4_title": "Same pages, live updates",
    "about.s4_body": "Returning users feel at home instantly \u2014 the same pages, panels, and words as the classic wallet \u2014 while balances, books, and connection status update live in place. Forgiving search across markets, accounts, and assets, three themes, and layouts that work from a 360px phone to a 4K trading desk.",
    "about.s5_body": "The chain speaks integers; you never see them. Every amount sits at its asset's decimals, every percent at its true value, and every fee is read from the live chain before you sign.",
    "htlc.list_sub": "Lock funds to a hash \u2014 the receiver redeems with the secret before expiry, or you are refunded. Readable by anyone; password asked only at signing.",
    "gateway.intro_a": "Send outside coins to the address shown. This page sends nothing. ",
    "gateway.intro_b": "Withdraws finish in Transfer with a live fee preview.",
    "help.topic_htlc_text": "Hash-locked swaps that either pay or refund.",
    "help.topic_voting_text": "Vote witnesses, committee, workers \u2014 or hand it to a proxy.",
    "news.explorer_blocks_and_transactions": "Explore the chain",
}

# flatkey -> real Spanish (human review still required; flagged in summary).
ES = {
    "splash.hero_title": "Billetera BitShares en tu navegador, nada que instalar.",
    "splash.hero_sub": "Tus claves. Tus fondos, en la cadena.",
    "splash.hero_sub2": "Explora los mercados gratis. Desbloquea solo para firmar.",
    "splash.cta_exchange": "Opera en el mercado",
    "dashboard.welcome": "Opera BTS con claves que t\u00fa controlas",
    "dashboard.tagline": "Explora los mercados gratis; crea una billetera para operar.",
    "splash.pulse_title": "N\u00fameros en vivo de la cadena",
    "splash.pulse_time": "Hora del \u00faltimo bloque",
    "splash.topvol_unavailable": "El volumen del mejor mercado no est\u00e1 disponible; revisa Ajustes \u2192 Nodos.",
    "splash.cards_title": "Opera, aporta, explora: empieza aqu\u00ed",
    "splash.card_dex_d": "Compra y vende en el mercado abierto.",
    "splash.card_pool_d": "Gana una parte al combinar dos activos.",
    "splash.card_explore_d": "Lee bloques e historial de cuentas.",
    "splash.card_wallet_d": "Guarda las claves solo en este dispositivo.",
    "splash.trust_keys_d": "La firma ocurre localmente en tu dispositivo. Ning\u00fan servidor ve jam\u00e1s tu contrase\u00f1a ni tus claves.",
    "splash.step1_t": "Explora",
    "splash.step1_d": "Sin registro: explora primero la cadena.",
    "splash.step2_t": "Crea una billetera",
    "splash.step2_d": "Un brainkey se genera en este dispositivo. Escr\u00edbelo en papel.",
    "splash.step3_t": "Opera, aporta y vota",
    "splash.step3_d": "\u00d3rdenes l\u00edmite, fondos de liquidez y votaciones, todo en la cadena.",
    "tour.s1_title": "Explora todo gratis, firma en local",
    "tour.s1_body": "Cada p\u00e1gina lee datos p\u00fablicos de la cadena sin registro. Abre un mercado para empezar; tu contrase\u00f1a solo se pide al firmar.",
    "tour.s3_title": "Mira gr\u00e1ficos de precios en vivo",
    "tour.s3_body": "Velas de precio, volumen y profundidad m\u00e1s el men\u00fa de indicadores: superposiciones como SMA y EMA, osciladores como RSI, MACD y Estoc\u00e1stico. Abre el mercado para verlo en vivo.",
    "tour.s4_title": "Practica comprar y vender",
    "tour.s4_body": "Los paneles de Compra y Venta aceptan cualquier n\u00famero para practicar. Nada sale de tu m\u00e1quina hasta que revises y firmes con la billetera desbloqueada. Abre el mercado para probarlo.",
    "about.hero_lede": "Una billetera para la cadena BitShares \u2014 mercados, cuentas, gobernanza y exploraci\u00f3n \u2014 como archivos web simples. Sin framework, sin instalador, sin cuenta con nosotros. Tus claves nunca salen de este navegador.",
    "about.s2_title": "Opera en el libro real de \u00f3rdenes",
    "about.s3_title": "Funciona por a\u00f1os sin actualizarse",
    "about.s3_body": "La billetera que reemplaza muri\u00f3 bajo cien paquetes obsoletos y herramientas irreproducibles. Hecha para evitar dependencias con ciclo de lanzamientos: sin framework, sin gestor de paquetes, sin compilaci\u00f3n; lo m\u00ednimo que a\u00fan funciona en un navegador dentro de una d\u00e9cada.",
    "about.s4_title": "Mismas p\u00e1ginas, datos en vivo",
    "about.s4_body": "Vuelves a casa al instante \u2014 mismas p\u00e1ginas, paneles y palabras que la billetera cl\u00e1sica \u2014 mientras saldos, libros y conexi\u00f3n se actualizan en vivo. B\u00fasqueda tolerante en mercados, cuentas y activos, tres temas y dise\u00f1os que van de un tel\u00e9fono de 360px a un escritorio 4K.",
    "about.s5_body": "La cadena habla en enteros; t\u00fa nunca los ves. Cada cantidad va en los decimales de su activo, cada porcentaje en su valor real y cada comisi\u00f3n se lee de la cadena en vivo antes de firmar.",
    "htlc.list_sub": "Bloquea fondos con un hash: el receptor los reclama con el secreto antes del vencimiento, o se te reembolsan. Visible para todos; la contrase\u00f1a solo se pide al firmar.",
    "gateway.intro_a": "Env\u00eda monedas externas a la direcci\u00f3n mostrada. Esta p\u00e1gina no env\u00eda nada. ",
    "gateway.intro_b": "Los retiros terminan en Transfer con vista previa de la comisi\u00f3n en vivo.",
    "help.topic_htlc_text": "Intercambios con bloqueo de hash que pagan o reembolsan.",
    "help.topic_voting_text": "Vota testigos, comit\u00e9 y trabajadores, o delega en un apoderado.",
    "news.explorer_blocks_and_transactions": "Explora la cadena",
}

# (flatkey, old line, new line) edits inside the two long help bodies.
BODY_EDITS_EN = [
    ("help.topic_bitshares_body",
     "# The fast decentralized exchange",
     "# The delegated-proof-of-stake exchange"),
    ("help.topic_bitshares_body",
     "- High performance and low cost: fast confirmation with small fees, and fair transparent matching where every order is provably handled.",
     "- Blocks every few seconds; every operation lists its chain fee before you sign."),
    ("help.topic_dex-intro_body",
     "# Secure and fast",
     "# Secured by your keys, settled on-chain"),
    ("help.topic_dex-intro_body",
     "This DEX confirms in real time \u2014 your only limits are physics and the planet's size.",
     "Orders settle on-chain, in blocks a few seconds apart \u2014 the matching rules are public and re-checkable."),
]
BODY_EDITS_ES = [
    ("help.topic_bitshares_body",
     "# El intercambio descentralizado r\u00e1pido",
     "# El intercambio de prueba de participaci\u00f3n delegada"),
    ("help.topic_bitshares_body",
     "- Alto rendimiento y bajo costo: confirmaci\u00f3n r\u00e1pida con comisiones peque\u00f1as, y coincidencia justa y transparente donde cada orden se maneja de forma demostrable.",
     "- Bloques cada pocos segundos; cada operaci\u00f3n muestra su comisi\u00f3n de cadena antes de firmar."),
    ("help.topic_dex-intro_body",
     "# Seguro y r\u00e1pido",
     "# Protegido por tus claves, liquidado en la cadena"),
    ("help.topic_dex-intro_body",
     "Este DEX confirma en tiempo real \u2014 sus \u00fanicos l\u00edmites son la f\u00edsica y el tama\u00f1o del planeta.",
     "Las \u00f3rdenes se liquidan en la cadena, en bloques de pocos segundos; las reglas de coincidencia son p\u00fablicas y verificables."),
]


def get_nested(d, flatkey):
    sec, sub = flatkey.split(".", 1)
    return d[sec][sub], sec, sub


def main():
    if set(NEW_EN) != set(ES):
        print("EN/ES key mismatch: %s" % (set(NEW_EN) ^ set(ES)))
        return 1
    dicts = {}
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        with io.open(path, encoding="utf-8") as f:
            dicts[code] = json.load(f)
    en_keys_before = set(dicts["en"]["_meta"]["translated"])
    for flatkey, new_en in sorted(NEW_EN.items()):
        old_en, sec, sub = get_nested(dicts["en"], flatkey)
        # Placeholder discipline: any %()s in the old value must survive.
        for code in CODES:
            old_val = dicts[code][sec][sub]
            if isinstance(old_val, str) and "%(" in old_val and "%(" not in new_en:
                print("REFUSED %s: old value carries a placeholder" % flatkey)
                return 1
        dicts["en"][sec][sub] = new_en
        dicts["es"][sec][sub] = ES[flatkey]
        for code in CODES:
            if code in ("en", "es"):
                continue
            dicts[code][sec][sub] = new_en
    for flatkey, old_line, new_line in BODY_EDITS_EN:
        sec, sub = flatkey.split(".", 1)
        body = dicts["en"][sec][sub]
        if body.count(old_line) != 1:
            print("REFUSED en %s: anchor found %d times" % (flatkey, body.count(old_line)))
            return 1
        dicts["en"][sec][sub] = body.replace(old_line, new_line)
    for flatkey, old_line, new_line in BODY_EDITS_ES:
        sec, sub = flatkey.split(".", 1)
        body = dicts["es"][sec][sub]
        if body.count(old_line) != 1:
            print("REFUSED es %s: anchor found %d times" % (flatkey, body.count(old_line)))
            return 1
        dicts["es"][sec][sub] = body.replace(old_line, new_line)
    # Other languages: apply the EN line swaps onto bodies that still carry
    # the old English lines (English-carrying dicts stay in sync); genuinely
    # translated bodies are left for their translators (honest: untouched,
    # never machine-translated). Applied per body so stacked edits compose.
    bodies = sorted(set(fk for fk, _ol, _nl in BODY_EDITS_EN))
    for flatkey in bodies:
        sec, sub = flatkey.split(".", 1)
        swaps = [(ol, nl) for fk, ol, nl in BODY_EDITS_EN if fk == flatkey]
        for code in CODES:
            if code in ("en", "es"):
                continue
            cur = dicts[code][sec][sub]
            for old_line, new_line in swaps:
                if cur.count(old_line) == 1:
                    cur = cur.replace(old_line, new_line)
            dicts[code][sec][sub] = cur
    # Key set must be unchanged (values only): inventory untouched.
    if set(dicts["en"]["_meta"]["translated"]) != en_keys_before:
        print("REFUSED: key set changed")
        return 1
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(dicts[code], f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("OK: %d keys updated in %d dicts (values only, key set unchanged)"
          % (len(NEW_EN), len(CODES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
