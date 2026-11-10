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
The **BetterIlias Companion** extension (for Chrome and Firefox) only accesses and processes data strictly necessary to connect your authenticated University of Bern ILIAS session (`https://ilias.unibe.ch`) with BetterIlias (`https://betterilias.ch`):

* **Authentication Information (`cookies` on `https://ilias.unibe.ch`):** When you sign in to `ilias.unibe.ch` or trigger synchronization, the extension reads your active ILIAS session cookies (`PHPSESSID` and `ilClientId`) from `https://ilias.unibe.ch` and transmits them over encrypted HTTPS (TLS) to `https://betterilias.ch/api/auth/sync` so BetterIlias can retrieve your lectures, course materials, and exercises on your behalf.
* **Local Extension Storage (`storage.local`):** The extension stores your BetterIlias session identifier (`session_id`), last synchronization timestamp, and auto-sync preference locally inside your browser.
* **Tab Handoff (`tabs` & content script on `https://betterilias.ch`):** The extension detects open `https://betterilias.ch` tabs to hand off your active BetterIlias session identifier without requiring a manual login form.

### 3. What Is Not Collected
* **No Passwords:** Neither the extension nor BetterIlias ever reads, collects, or stores your University of Bern / Switch edu-ID password.
* **No Browsing History or Analytics:** The extension does not access any websites other than `https://ilias.unibe.ch` and `https://betterilias.ch`. No analytics, telemetry, or advertising trackers are used.
* **No Third-Party Sharing or Sale:** User data is never sold, rented, or transferred to third parties, and is never used for advertising or creditworthiness assessment.

### 4. Server Processing, Retention & Deletion
* **Isolated Sessions:** Session cookies forwarded to `https://betterilias.ch` are stored in isolated per-session storage and are used exclusively to proxy your own requests to `https://ilias.unibe.ch`. Expired or logged-out sessions are deleted automatically.
* **Hosting Location:** The server is hosted in an ISO-27001-certified datacenter in Nuremberg, Germany (EU), with end-to-end TLS encryption.
* **Deletion:** Clicking **Disconnect / Log out** in BetterIlias or uninstalling the browser extension immediately revokes and removes your stored session data.

---

## Deutsch (Datenschutzerklärung)

### 1. Verantwortliche Stelle & Kontakt
Verantwortlich für die Datenverarbeitung im Sinne des Schweizer Datenschutzgesetzes (revDSG) und der EU-Datenschutz-Grundverordnung (DSGVO) ist das **BetterIlias-Projekt**:
* **E-Mail:** `manuel@betterilias.ch`
* **Website:** `https://betterilias.ch`
* **Quellcode:** `https://github.com/M4anuel/betterilias`

### 2. Verarbeitete Daten durch die Browser-Erweiterung (BetterIlias Companion)
Die Browser-Erweiterung **BetterIlias Companion** (für Chrome und Firefox) verarbeitet ausschliesslich Daten, die technisch zwingend erforderlich sind, um deine aktive ILIAS-Sitzung der Universität Bern (`https://ilias.unibe.ch`) mit BetterIlias (`https://betterilias.ch`) zu verbinden:

* **Authentifizierungsdaten (`cookies` auf `https://ilias.unibe.ch`):** Bei der Anmeldung auf `ilias.unibe.ch` oder beim Klick auf Synchronisieren liest die Erweiterung deine aktiven ILIAS-Sitzungscookies (`PHPSESSID` und `ilClientId`) von `https://ilias.unibe.ch` und überträgt diese verschlüsselt über HTTPS (TLS) an `https://betterilias.ch/api/auth/sync`, damit BetterIlias deine Vorlesungen, Materialien und Übungen in deinem Auftrag abrufen kann.
* **Lokaler Erweiterungsspeicher (`storage.local`):** Die Erweiterung speichert deine BetterIlias-Sitzungskennung (`session_id`), den Zeitpunkt der letzten Synchronisation sowie die Einstellung zur automatischen Synchronisation lokal in deinem Browser.
* **Tab-Übergabe (`tabs` & Content-Script auf `https://betterilias.ch`):** Die Erweiterung übergibt die aktive Sitzungskennung direkt an geöffnete `https://betterilias.ch`-Tabs.

### 3. Was nicht erfasst wird
* **Keine Passwörter:** Weder die Erweiterung noch BetterIlias lesen oder speichern jemals dein Switch edu-ID- oder UniBe-Passwort.
* **Kein Browserverlauf & kein Tracking:** Die Erweiterung greift auf keine anderen Webseiten als `https://ilias.unibe.ch` und `https://betterilias.ch` zu. Es werden keinerlei Analyse-Tools oder Werbetracker eingesetzt.
* **Keine Weitergabe an Dritte:** Daten werden niemals verkauft oder zu Werbezwecken an Dritte weitergegeben.

### 4. Serverstandort, Aufbewahrung & Löschung
* **Isolierte Sitzungen:** Übermittelte Sitzungstokens werden auf dem Server streng isoliert verwaltet und nach Abmeldung oder Ablauf automatisch gelöscht.
* **Serverstandort:** Der Server wird in einem ISO-27001-zertifizierten Rechenzentrum in Nürnberg, Deutschland (EU) betrieben.
* **Löschung:** Durch Abmelden in BetterIlias oder Deinstallieren der Erweiterung werden die gespeicherten Sitzungsdaten sofort entfernt.
