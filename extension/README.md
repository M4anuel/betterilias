# BetterIlias Companion — Chrome Extension

Diese Browser-Erweiterung ermöglicht es, deine bestehende Uni Bern ILIAS-Sitzung (via SWITCH edu-ID) mit nur einem Klick sicher an BetterIlias zu übermitteln.

> [!NOTE]
> Nutzt du Mozilla Firefox? Die dedizierte Firefox-Erweiterung findest du im Ordner [`extension-firefox/`](../extension-firefox).

---

## 🚀 Installation in Chrome / Edge / Brave

1. **Repository herunterladen oder klonen**:
   - Lade den Ordner `extension/` von GitHub herunter:
     [https://github.com/M4anuel/betterilias/tree/main/extension](https://github.com/M4anuel/betterilias/tree/main/extension)
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
   - Wähle den heruntergeladenen Ordner `extension` aus.

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

- **Sitzungsstatus**: Amber mit `…` bedeutet Prüfung, grün mit `✓` eine erfolgreich geprüfte Sitzung und rot mit `!` eine fehlende oder ungültige Sitzung. Dann öffnet **"Bei ILIAS anmelden"** die Anmeldung. Amber mit `?` bedeutet, dass die Prüfung gerade nicht möglich ist, etwa bei einem nicht erreichbaren Backend. Vorhandene Cookies allein gelten nicht als erfolgreiche Anmeldung.

- **Dark Mode Support**: Erkennt automatisch die Systemeinstellungen deines Betriebssystems (`prefers-color-scheme`).
- **Sicher & Datenschutzfreundlich**: Liest ausschließlich Cookies für `ilias.unibe.ch`. Keine Passwörter werden abgefangen oder gespeichert.
