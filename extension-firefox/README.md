# BetterIlias Companion — Firefox Extension

Diese Browser-Erweiterung ermöglicht es, deine bestehende Uni Bern ILIAS-Sitzung (via SWITCH edu-ID) in Mozilla Firefox mit nur einem Klick sicher an BetterIlias zu übermitteln.

---

## 🚀 Installation in Mozilla Firefox

1. **Repository herunterladen oder klonen**:
   - Lade den Ordner `extension-firefox/` von GitHub herunter:
     [https://github.com/M4anuel/betterilias/tree/main/extension-firefox](https://github.com/M4anuel/betterilias/tree/main/extension-firefox)
   - Oder klone das gesamte Repository:
     ```bash
     git clone https://github.com/M4anuel/betterilias.git
     ```

2. **Firefox Add-on-Debugging öffnen**:
   - Tippe in der Adressleiste von Firefox folgendes ein und drücke Enter:
     ```text
     about:debugging#/runtime/this-firefox
     ```
   - (Alternativ: Menü ☰ &gt; **Weitere Werkzeuge** &gt; **Entwickler-Werkzeuge** &gt; **Dieses Firefox**).

3. **Temporäres Add-on laden**:
   - Klicke auf die Schaltfläche **„Temporäres Add-on laden...“** (Load Temporary Add-on...).
   - Navigiere in den Ordner `extension-firefox` und wähle die Datei `manifest.json` aus.

4. **Fertig!**
   - Das BetterIlias-Icon erscheint in deiner Firefox-Symbolleiste (kann über das Puzzle-Symbol dauerhaft an die Symbolleiste geheftet werden).

---

## 🛠️ Verwendung

1. Melde dich ganz normal in Firefox auf [ilias.unibe.ch](https://ilias.unibe.ch) mit deiner SWITCH edu-ID an.
2. Klicke auf das **BetterIlias-Icon** in der Firefox-Symbolleiste.
3. Beim Öffnen wird die Sitzung über das Backend bei ILIAS geprüft und synchronisiert. Mit **„Sitzung mit BetterIlias synchronisieren“** kannst du die Prüfung erneut starten.
4. Sobald die grüne Erfolgsmeldung erscheint, klicke auf **„BetterIlias öffnen“**. Deine Vorlesungen, Übungen und Materialien stehen sofort bereit!

---

## 🎨 Features & Sicherheit

- **Sitzungsstatus**: Ein kleiner Punkt am Toolbar-Logo ist amber während der Prüfung oder wenn sie nicht möglich ist, grün nach erfolgreicher Prüfung und rot bei einer fehlenden oder ungültigen Sitzung. Die genaue Bedeutung steht in der Kurzinfo und im Popup. **„Bei ILIAS anmelden“** öffnet die Anmeldung. Vorhandene Cookies allein gelten nicht als erfolgreiche Anmeldung.

- **Manifest V3 & Gecko-optimiert**: Entwickelt nach den neuesten Mozilla WebExtension MV3 Standards.
- **Dark Mode Support**: Passt sich automatisch den Systemeinstellungen an (`prefers-color-scheme`).
- **Sicher & Datenschutzfreundlich**: Liest ausschließlich Cookies für `ilias.unibe.ch`. Passwörter oder persönliche Daten werden zu keinem Zeitpunkt abgefangen.

