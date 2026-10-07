#!/usr/bin/env python3
"""add_version_compare_i18n.py — footer version-compare opt-in toggle keys.

Adds settings.vc_toggle + settings.vc_note (the outbound GitHub compare
switch found by the two-ended viewport audit: the compare was the ONE
third-party request the wallet made, fired unconditionally on every page load
of every route, 404ing because the repo is not publicly published). All 12
vanilla/locales/*.json get a REAL translation, not an English stub, because
these dicts are fully translated (untranslated=false) and principle #10
forbids an unverified string passing as translated.

The en.json _meta.translated inventory stays sorted, as check_i18n expects.
Idempotent: never clobbers an existing value.

Stdlib only. Usage: python3 tooling/add_version_compare_i18n.py
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

KEYS = {
    "en": {
        "settings.vc_toggle": "Check GitHub for a newer version",
        "settings.vc_note": "Sends one request to GitHub from your browser. Off by default; the local version stamp below always shows without any network call.",
    },
    "de": {
        "settings.vc_toggle": "Auf GitHub nach einer neueren Version suchen",
        "settings.vc_note": "Sendet eine Anfrage aus Ihrem Browser an GitHub. Standardmäßig aus; der lokale Versionsstempel unten wird immer ohne Netzwerkzugriff angezeigt.",
    },
    "es": {
        "settings.vc_toggle": "Buscar en GitHub una versión más reciente",
        "settings.vc_note": "Envía una solicitud a GitHub desde tu navegador. Desactivado por defecto; la marca de versión local de abajo siempre se muestra sin ninguna llamada de red.",
    },
    "fr": {
        "settings.vc_toggle": "Vérifier sur GitHub si une version plus récente existe",
        "settings.vc_note": "Envoie une requête à GitHub depuis votre navigateur. Désactivé par défaut ; le tampon de version local ci-dessous s'affiche toujours sans appel réseau.",
    },
    "it": {
        "settings.vc_toggle": "Controlla su GitHub se c'è una versione più recente",
        "settings.vc_note": "Invia una richiesta a GitHub dal tuo browser. Disattivato per impostazione predefinita; il contrassegno della versione locale qui sotto viene sempre mostrato senza alcuna chiamata di rete.",
    },
    "ja": {
        "settings.vc_toggle": "GitHub で新しいバージョンを確認する",
        "settings.vc_note": "ブラウザから GitHub へ 1 件のリクエストを送信します。既定では無効です。下部のローカルバージョン表示はネットワーク通信なしで常に表示されます。",
    },
    "ko": {
        "settings.vc_toggle": "GitHub에서 새 버전 확인",
        "settings.vc_note": "브라우저에서 GitHub로 요청 1건을 전송합니다. 기본값은 꺼짐이며, 아래의 로컬 버전 표시는 네트워크 호출 없이 항상 표시됩니다.",
    },
    "ru": {
        "settings.vc_toggle": "Проверить GitHub на наличие новой версии",
        "settings.vc_note": "Отправляет один запрос в GitHub из вашего браузера. По умолчанию выключено; локальная отметка версии ниже всегда отображается без сетевых запросов.",
    },
    "tr": {
        "settings.vc_toggle": "GitHub'da daha yeni bir sürüm olup olmadığını kontrol et",
        "settings.vc_note": "Tarayıcınızdan GitHub'a tek bir istek gönderir. Varsayılan olarak kapalıdır; aşağıdaki yerel sürüm damgası herhangi bir ağ çağrısı olmadan her zaman gösterilir.",
    },
    "zh": {
        "settings.vc_toggle": "在 GitHub 上检查是否有更新版本",
        "settings.vc_note": "从你的浏览器向 GitHub 发送一次请求。默认关闭；下方的本地版本标记无需任何网络请求即可始终显示。",
    },
    "hi": {
        "settings.vc_toggle": "GitHub पर नया संस्करण देखें",
        "settings.vc_note": "आपके ब्राउज़र से GitHub पर एक अनुरोध भेजता है। डिफ़ॉल्ट रूप से बंद; नीचे स्थानीय संस्करण मुहर हमेशा बिना किसी नेटवर्क कॉल के दिखती है।",
    },
    "pt": {
        "settings.vc_toggle": "Verificar no GitHub se há uma versão mais recente",
        "settings.vc_note": "Envia um pedido ao GitHub a partir do seu navegador. Desativado por padrão; a marca de versão local abaixo é sempre apresentada sem qualquer chamada de rede.",
    },
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)

        section = data.get("settings")
        if not isinstance(section, dict):
            print("settings section MISSING in %s" % path)
            return 1

        for dotted, value in sorted(KEYS[code].items()):
            key = dotted.split(".", 1)[1]
            if key not in section:
                section[key] = value

        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in KEYS[code]:
                if dotted not in inv:
                    inv.append(dotted)
            inv.sort()

        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())