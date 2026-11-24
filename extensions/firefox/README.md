# BetterIlias Companion — Firefox Extension

Diese Browser-Erweiterung ermöglicht es, deine bestehende Uni Bern ILIAS-Sitzung (via SWITCH edu-ID) in Mozilla Firefox mit nur einem Klick sicher an BetterIlias zu übermitteln.

Das Backend ersetzt gespeicherte Zugangsdaten erst nach einer erfolgreichen
Prüfung bei ILIAS. Netzwerkfehler, Zeitüberschreitungen oder begrenzte Anfragen
sind kein Nachweis einer abgelaufenen Sitzung: Die Erweiterung behält die
gespeicherte Verbindungskennung und erlaubt einen erneuten Versuch. Vorhandene
Cookies allein gelten nicht als erfolgreiche Anmeldung. Der Backend-Transport
sendet ILIAS-Cookies ausschliesslich an die konfigurierte ILIAS-Instanz.

---

## 🚀 Installation in Mozilla Firefox

Installiere [BetterIlias Companion aus Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/betterilias-companion/)
und bestätige die Installation in Firefox. Öffne danach die Erweiterung über das
Puzzle-Symbol in der Symbolleiste. Die Store-Version verbindet sich mit
`https://betterilias.ch` und bleibt nach einem Browser-Neustart installiert.

### Temporäre Installation für Entwicklung und eigene Server

Für eine lokale Entwicklungsversion oder eine angepasste Server-Adresse:

1. **Repository herunterladen oder klonen**:
   - Lade den Ordner `extensions/firefox/` von GitHub herunter:
     [https://github.com/M4anuel/betterilias/tree/main/extensions/firefox](https://github.com/M4anuel/betterilias/tree/main/extensions/firefox)
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
   - Navigiere in den Ordner `extensions/firefox` und wähle die Datei `manifest.json` aus.

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
- **Sicher & Datenschutzfreundlich**: Verwendet ILIAS-Cookies für die bestehende Verbindung. Der optionale Unisport-Abruf verwendet die ZSSW-Website-Sitzung lokal; ihre Cookies werden nicht zum BetterIlias-Server gesendet. Passwörter werden nicht gelesen oder gespeichert.



## Deployment and connection links

Login uses this companion; the backend no longer offers local Playwright login
or manual cookie entry. Opening BetterIlias uses a single-use connection code
valid for 60 seconds, rather than putting the session ID in the address bar.
The manifest currently permits the listed localhost origins; add the intended
production hostname before publishing a production extension. Use development
mode for a local HTTP backend, and same-origin HTTPS for the deployed app/API.
See [deployment security](../../docs/DEPLOYMENT_SECURITY.md) for exact requirements.

## UniSport participant lists (Companion 1.2.0)

Reload/install this extension version, accept access to `www.zssw.unibe.ch` and
reload BetterIlias. Participant lists open inside BetterIlias with live search
and a five-minute private tab cache. Use the dialog's official-page link to sign
in to ZSSW with SWITCH if needed, then return and refresh. The native connection
and website login remain separate. Use a regular window without Firefox
containers; private/container windows retain the official-page fallback.
The Firefox declaration includes website content and identifying information
for names displayed locally in BetterIlias. No browser-store publication is implied.
