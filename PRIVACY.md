# Privacy Policy / Datenschutzerklärung — BetterIlias & BetterIlias Companion

*Last updated / Stand: November 2026*

---

## English

### 1. Controller & Contact
The **BetterIlias Project** is responsible for data processing in accordance with the Swiss Federal Act on Data Protection (revDSG) and the EU General Data Protection Regulation (GDPR).
* **Email:** `manuel@betterilias.ch`
* **Website:** `https://betterilias.ch`
* **Source Code:** `https://github.com/M4anuel/betterilias`

### 2. Data Processed by the BetterIlias Companion Browser Extension
The **BetterIlias Companion** extension (for Chrome, Firefox and Safari) only accesses and processes data strictly necessary to connect your authenticated University of Bern ILIAS session (`https://ilias.unibe.ch`) with BetterIlias (`https://betterilias.ch`):

* **Authentication Information (`cookies` on `https://ilias.unibe.ch`):** When you sign in to `ilias.unibe.ch` or trigger synchronization, the extension reads your active ILIAS session cookies (`PHPSESSID` and `ilClientId`) from `https://ilias.unibe.ch` and transmits them over encrypted HTTPS (TLS) to `https://betterilias.ch/api/auth/sync` so BetterIlias can retrieve your lectures, course materials, and exercises on your behalf.
* **Local Extension Storage (`storage.local`):** The extension stores your BetterIlias session identifier (`session_id`), last synchronization timestamp, and auto-sync preference locally inside your browser.
* **Tab Handoff (`tabs` & content script on `https://betterilias.ch`):** The extension detects open `https://betterilias.ch` tabs to hand off your active BetterIlias session identifier without requiring a manual login form.

### 3. What Is Not Collected
* **No Passwords:** Neither the extension nor BetterIlias ever reads, collects, or stores your University of Bern / Switch edu-ID password.
* **No Browsing History or Analytics:** The extension accesses ILIAS, the configured BetterIlias instance and, for the opt-in UniSport prototype in Chrome/Firefox, SWITCH login completion at `https://login.eduid.ch`. It does not collect browsing history or use advertising trackers.
* **No Third-Party Sharing or Sale:** User data is never sold, rented, or transferred to third parties, and is never used for advertising or creditworthiness assessment.

### 4. Server Processing, Retention & Deletion
* **Isolated Sessions:** Session cookies forwarded to `https://betterilias.ch` are stored in isolated per-session storage and are used exclusively to proxy your own requests to `https://ilias.unibe.ch`. Expired or logged-out sessions are deleted automatically.
* **Hosting Location:** The server is hosted in an ISO-27001-certified datacenter in Nuremberg, Germany (EU), with end-to-end TLS encryption.
* **Deletion:** Use the relevant connection's **Disconnect / Log out** action in BetterIlias to remove its server-side credentials. Uninstalling the extension does not itself revoke server-side sessions.

### 5. Optional UniSport Prototype (Chrome / Firefox)
When explicitly connecting UniSport, you sign in directly on SWITCH's website.
The companion observes the native login callback in its own login tab and sends
the authorization code to your configured BetterIlias instance. It reads neither
passwords nor OTP/login form inputs. The instance exchanges the code with SWITCH,
verifies the ID token and uses it with `api.uniapp-backend.unibe.ch` to retrieve
your affiliations and, on request, registrations. This is separate from ILIAS.

The page stores a random UniSport connection capability in localStorage. Pending
companion state is held in browser session storage for at most ten minutes of
validity. The server stores a capability hash, pending PKCE/nonce state and then
the ID token, account subject and selected affiliation in a private database.
No refresh token is retained. Server connections expire at token expiry or after
one hour; expired records are removed on access or the next login start.
Disconnect removes the connection immediately. Closing the browser or removing
the companion does not delete an established server connection or log out SWITCH.
Safari does not include this prototype. These practices may be updated as the
prototype develops; this policy will be updated when data use changes.

---

## Deutsch (Datenschutzerklärung)

### 1. Verantwortliche Stelle & Kontakt
Verantwortlich für die Datenverarbeitung im Sinne des Schweizer Datenschutzgesetzes (revDSG) und der EU-Datenschutz-Grundverordnung (DSGVO) ist das **BetterIlias-Projekt**:
* **E-Mail:** `manuel@betterilias.ch`
* **Website:** `https://betterilias.ch`
* **Quellcode:** `https://github.com/M4anuel/betterilias`

### 2. Verarbeitete Daten durch die Browser-Erweiterung (BetterIlias Companion)
Die Browser-Erweiterung **BetterIlias Companion** (für Chrome, Firefox und Safari) verarbeitet ausschliesslich Daten, die technisch zwingend erforderlich sind, um deine aktive ILIAS-Sitzung der Universität Bern (`https://ilias.unibe.ch`) mit BetterIlias (`https://betterilias.ch`) zu verbinden:

* **Authentifizierungsdaten (`cookies` auf `https://ilias.unibe.ch`):** Bei der Anmeldung auf `ilias.unibe.ch` oder beim Klick auf Synchronisieren liest die Erweiterung deine aktiven ILIAS-Sitzungscookies (`PHPSESSID` und `ilClientId`) von `https://ilias.unibe.ch` und überträgt diese verschlüsselt über HTTPS (TLS) an `https://betterilias.ch/api/auth/sync`, damit BetterIlias deine Vorlesungen, Materialien und Übungen in deinem Auftrag abrufen kann.
* **Lokaler Erweiterungsspeicher (`storage.local`):** Die Erweiterung speichert deine BetterIlias-Sitzungskennung (`session_id`), den Zeitpunkt der letzten Synchronisation sowie die Einstellung zur automatischen Synchronisation lokal in deinem Browser.
* **Tab-Übergabe (`tabs` & Content-Script auf `https://betterilias.ch`):** Die Erweiterung übergibt die aktive Sitzungskennung direkt an geöffnete `https://betterilias.ch`-Tabs.

### 3. Was nicht erfasst wird
* **Keine Passwörter:** Weder die Erweiterung noch BetterIlias lesen oder speichern jemals dein Switch edu-ID- oder UniBe-Passwort.
* **Kein Browserverlauf & kein Tracking:** Die Erweiterung greift auf ILIAS, die konfigurierte BetterIlias-Instanz und beim optionalen UniSport-Prototyp in Chrome/Firefox auf den Anmeldeabschluss unter `https://login.eduid.ch` zu. Sie erfasst keinen Browserverlauf und verwendet keine Werbetracker.
* **Keine Weitergabe an Dritte:** Daten werden niemals verkauft oder zu Werbezwecken an Dritte weitergegeben.

### 4. Serverstandort, Aufbewahrung & Löschung
* **Isolierte Sitzungen:** Übermittelte Sitzungstokens werden auf dem Server streng isoliert verwaltet und nach Abmeldung oder Ablauf automatisch gelöscht.
* **Serverstandort:** Der Server wird in einem ISO-27001-zertifizierten Rechenzentrum in Nürnberg, Deutschland (EU) betrieben.
* **Löschung:** Trenne die jeweilige Verbindung in BetterIlias, um ihre Zugangsdaten auf dem Server zu entfernen. Das Deinstallieren der Erweiterung widerruft serverseitige Sitzungen nicht automatisch.

### 5. Optionaler UniSport-Prototyp (Chrome / Firefox)
Beim ausdrücklichen Verbinden mit UniSport meldest du dich direkt auf der
SWITCH-Webseite an. Der Companion erkennt die native Anmeldeantwort im eigenen
Anmelde-Tab und übermittelt den Autorisierungscode an deine konfigurierte
BetterIlias-Instanz. Er liest keine Passwörter, Einmalcodes oder Eingaben in
Anmeldeformularen. Die Instanz tauscht den Code bei SWITCH ein, prüft das ID-Token
und verwendet es gegenüber `api.uniapp-backend.unibe.ch`, um Zugehörigkeiten und
auf Anfrage deine Anmeldungen abzurufen. Diese Verbindung ist unabhängig von ILIAS.

Die Webseite speichert eine zufällige UniSport-Verbindungskennung in localStorage.
Ausstehende Companion-Anmeldungen liegen im Browser-Sitzungsspeicher und sind
höchstens zehn Minuten gültig. Der Server speichert einen Hash der Kennung,
ausstehende PKCE-/Nonce-Daten und anschliessend das ID-Token, die Kontokennung und
die gewählte Zugehörigkeit in einer privaten Datenbank. Es wird kein Refresh-Token
aufbewahrt. Verbindungen laufen mit dem Token, spätestens nach einer Stunde ab.
Abgelaufene Einträge werden beim Zugriff oder dem nächsten Anmeldestart entfernt.
Das Trennen der Verbindung löscht sie sofort. Das Schliessen des Browsers oder
Entfernen des Companions löscht keine bestehende Serververbindung und meldet dich
nicht bei SWITCH ab. Safari enthält diesen Prototyp nicht. Bei Änderungen der
Datenverwendung wird diese Erklärung aktualisiert.
