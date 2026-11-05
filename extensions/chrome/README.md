# BetterIlias Companion — Chrome Extension

Diese Browser-Erweiterung ermöglicht es, deine bestehende Uni Bern ILIAS-Sitzung (via SWITCH edu-ID) mit nur einem Klick sicher an BetterIlias zu übermitteln.

Das Backend ersetzt gespeicherte Zugangsdaten erst nach einer erfolgreichen
Prüfung bei ILIAS. Netzwerkfehler, Zeitüberschreitungen oder begrenzte Anfragen
sind kein Nachweis einer abgelaufenen Sitzung: Die Erweiterung behält die
gespeicherte Verbindungskennung und erlaubt einen erneuten Versuch. Vorhandene
Cookies allein gelten nicht als erfolgreiche Anmeldung. Der Backend-Transport
sendet ILIAS-Cookies ausschliesslich an die konfigurierte ILIAS-Instanz.

> [!NOTE]
> Nutzt du Mozilla Firefox? Die dedizierte Firefox-Erweiterung findest du im Ordner [`extensions/firefox/`](../firefox).

---

## 🚀 Installation in Chrome / Edge / Brave

1. **Repository herunterladen oder klonen**:
   - Lade den Ordner `extensions/chrome/` von GitHub herunter:
     [https://github.com/M4anuel/betterilias/tree/main/extensions/chrome](https://github.com/M4anuel/betterilias/tree/main/extensions/chrome)
   - Oder klone das Repository:
     ```bash
     git clone https://github.com/M4anuel/betterilias.git
     ```

2. **Browser-Erweiterungsverwaltung öffnen**:
   - In Google Chrome oder Brave: Öffne `chrome://extensions` in der Adressleiste.
   - In Microsoft Edge: Öffne `edge://extensions`.

3. **Entwicklermodus aktivieren**:
   - Schalte oben rechts den Schalter **"Entwicklermodus"** (Developer mode) ein.

4. **Erweiterung laden**:
   - Klicke oben links auf die Schaltfläche **"Entpackte Erweiterung laden"** (Load unpacked).
   - Wähle den heruntergeladenen Ordner `extensions/chrome` aus.

5. **Fertig!**
   - Das BetterIlias-Icon erscheint in deiner Browser-Leiste (eventuell unter dem Puzzle-Symbol anheften).

---

## 🛠️ Verwendung

1. Melde dich ganz normal in deinem Browser auf [ilias.unibe.ch](https://ilias.unibe.ch) mit deiner SWITCH edu-ID an.
2. Klicke auf das **BetterIlias-Icon** in der Browser-Symbolleiste.
3. Beim Öffnen wird die Sitzung über das Backend bei ILIAS geprüft und synchronisiert. Mit **"Sitzung mit BetterIlias synchronisieren"** kannst du die Prüfung erneut starten.
4. Sobald das grüne Häkchen erscheint, klicke auf **"BetterIlias öffnen"**. BetterIlias lädt deine Kurse und Materialien sofort!

---

## 🎨 Features

- **Sitzungsstatus**: Ein kleiner Punkt am Toolbar-Logo ist amber während der Prüfung oder wenn sie nicht möglich ist, grün nach erfolgreicher Prüfung und rot bei einer fehlenden oder ungültigen Sitzung. Die genaue Bedeutung steht in der Kurzinfo und im Popup. **"Bei ILIAS anmelden"** öffnet die Anmeldung. Vorhandene Cookies allein gelten nicht als erfolgreiche Anmeldung.

- **Dark Mode Support**: Erkennt automatisch die Systemeinstellungen deines Betriebssystems (`prefers-color-scheme`).
- **Sicher & Datenschutzfreundlich**: Liest ausschliesslich Cookies für `ilias.unibe.ch`. Keine Passwörter werden abgefangen oder gespeichert.


## Deployment and connection links

Login uses this companion; the backend no longer offers local Playwright login
or manual cookie entry. Opening BetterIlias uses a single-use connection code
valid for 60 seconds, rather than putting the session ID in the address bar.
The manifest currently permits the listed localhost origins; add the intended
production hostname before publishing a production extension. Use development
mode for a local HTTP backend, and same-origin HTTPS for the deployed app/API.
See [deployment security](../docs/DEPLOYMENT_SECURITY.md) for exact requirements.
