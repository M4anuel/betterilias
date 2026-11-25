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
your affiliations and, on request, registrations. Its credentials remain separate
from ILIAS session storage.

From 1.8.0, **Connect ILIAS with this login** optionally sends the server-held
UniBE ID token and selected affiliation to the fixed UniBE ILIAS mobile-auth
entry/alias over HTTPS. A separate request verifies the resulting ILIAS cookies
against the authenticated personal dashboard before a fresh isolated ILIAS
connection is saved. The ID token is not saved in that ILIAS session file or
sent to the page. The page receives only the new BetterIlias capability and
verified display name, using the existing account-switch/cache-clearing flow.
Existing credentials remain intact on failure. The new ILIAS connection follows
normal ILIAS session retention; disconnect UniSport and log out ILIAS separately.
Initial SWITCH login still uses the Companion. No browser cookie export is
needed for this optional ILIAS exchange.

Companion 1.3.0 respects the page's `betterilias_ilias_source=unisport` preference
in localStorage so automatic/cached cookie sync does not replace that selection.
Manual Companion sync or a successfully claimed connection handoff clears this
preference. It contains no token or additional credential and is separate for
each BetterIlias origin.

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

UniSport public catalogue data, derived sport types and offer details are cached
on the server and in browser IndexedDB without account credentials or personal
bookmark flags. Private bookmark/registration results may be cached in browser
tab storage for one minute of validity, scoped to the current login generation,
affiliation and language; disconnect clears those personal caches. Public caches
can be removed through the browser's site-data controls. Server public caches
retain previous complete snapshots for up to seven days; the detail cache is
bounded to 128 entries. Browser public snapshots can remain until replaced,
evicted or cleared, with timestamps and stale-data feedback when displayed.

Companion 1.2.0 and later can read the official ZSSW participant list on request using the
browser's existing website session. It accesses cookies applicable to
`https://www.zssw.unibe.ch` locally to compute an opaque, instance/connection-bound
cache identity; those cookie values are not forwarded to BetterIlias. Only the
fixed participant-list route is fetched. Its HTML stays in the browser, is parsed
inertly into names and offer text, and is not injected into the page or uploaded
to the BetterIlias server. No passwords or login inputs are read. Names/offers
may be cached for five minutes in the tab, bounded to 20 lists and scoped to the
native login generation, affiliation, website course and website-session identity.
Opening a cached list rechecks that identity; website-cookie changes invalidate
visible data when the identity changes. Native disconnect clears private caches,
and closing the tab removes the tab store. A normal Chrome/Firefox window and
the updated Companion are required; incognito/private windows and Firefox
containers are unsupported for this read. The official list remains a fallback.

From Companion 1.2.1, you can complete website login in an official tab. The
extension stores only tab IDs, BetterIlias origin, native scope/affiliation,
fixed return path and a ten-minute expiry in extension session storage. It
observes the return to ZSSW and resumes the requested list read. It does not
read the SWITCH identity chooser, passwords or SAML responses. Completion,
cancellation and native disconnect remove the transaction; expired transactions
are ignored and removed on the next start.

Private native registration snapshots are also cached on the server with one
minute of validity, under private file permissions and isolated by connection capability
hash, login generation, affiliation and language. No token is copied into that
cache. Reads coalesce; explicit refresh bypasses older entries. Booking operations
invalidate the account's cached snapshots before and after dispatch and outcome
checks. Authorization and booking verification always fetch fresh private data
instead of using these snapshots. Expired cache rows are pruned on access and
disconnect removes the connection's cached rows.

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
auf Anfrage deine Anmeldungen abzurufen. Die Zugangsdaten werden getrennt von
den ILIAS-Sitzungen gespeichert.

Ab 1.8.0 übermittelt **ILIAS mit dieser Anmeldung verbinden** auf Wunsch das
serverseitige UniBE-ID-Token und die gewählte Zugehörigkeit über HTTPS an den
festen UniBE-ILIAS-Mobile-Auth-Einstieg bzw. dessen Alias. Ein separater Abruf
prüft die entstandenen ILIAS-Cookies anhand der angemeldeten persönlichen
Startseite, bevor eine neue isolierte ILIAS-Verbindung gespeichert wird. Das
ID-Token wird weder in dieser ILIAS-Sitzungsdatei gespeichert noch an die
Webseite gesendet. Die Webseite erhält nur die neue BetterIlias-Kennung und den
bestätigten Anzeigenamen und verwendet den bestehenden Kontowechsel mit
Cache-Löschung. Bei einem Fehler bleiben bisherige Zugangsdaten erhalten.
Die neue ILIAS-Verbindung unterliegt der normalen Aufbewahrung von
ILIAS-Sitzungen; UniSport trennen und ILIAS abmelden erfolgt separat. Die erste
SWITCH-Anmeldung verwendet weiterhin den Companion. Für diesen optionalen
ILIAS-Austausch müssen keine Browser-Cookies exportiert werden.

Companion 1.3.0 berücksichtigt die localStorage-Einstellung
`betterilias_ilias_source=unisport`, damit automatische oder gespeicherte
Cookie-Synchronisation diese Auswahl nicht ersetzt. Manuelles Synchronisieren
im Companion oder ein erfolgreich eingelöster Verbindungscode entfernt diese
Einstellung. Sie enthält kein Token und keine zusätzliche Zugangskennung und
gilt getrennt je BetterIlias-Ursprung.

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

Öffentliche Unisport-Angebote, daraus abgeleitete Sportarten und Angebotsdetails
werden auf dem Server und im Browser in IndexedDB gespeichert, ohne Zugangsdaten
oder persönliche Merkliste-Markierungen. Persönliche Merklisten und Anmeldungen
können für eine Minute Gültigkeit im Browser-Tab gespeichert werden, getrennt
nach Anmeldung, Zugehörigkeit und Sprache. Das Trennen der Verbindung löscht
diese persönlichen Caches. Öffentliche Browser-Caches lassen sich über die
Webseitendaten-Einstellungen löschen. Der Server behält vorherige vollständige
öffentliche Datenstände bis zu sieben Tage und höchstens 128 Angebotsdetails.
Öffentliche Browser-Daten bleiben gegebenenfalls bis zum Ersetzen, Verdrängen oder
Löschen erhalten; bei der Anzeige erscheinen Zeitstempel und Hinweise auf ältere
Daten.

Companion 1.2.0 und neuer kann auf Wunsch die offizielle ZSSW-Anmeldeliste mit der
bestehenden Website-Sitzung des Browsers lesen. Cookies für
`https://www.zssw.unibe.ch` werden lokal verwendet, um eine undurchsichtige,
an Instanz und Verbindung gebundene Cache-Kennung zu berechnen. Diese Cookie-Werte
werden nicht an BetterIlias übermittelt. Es wird nur die feste Anmeldelisten-Route
abgerufen. Das HTML bleibt im Browser und wird inaktiv in Namen und Angebotstext
zerlegt, weder in die Webseite eingefügt noch zum BetterIlias-Server hochgeladen.
Passwörter und Anmeldeeingaben werden nicht gelesen. Bis zu 20 Listen können mit
fünf Minuten Gültigkeit im Tab gespeichert werden, getrennt nach nativer
Anmeldung, Zugehörigkeit, Website-Kurs und Website-Sitzung. Beim Öffnen wird die
Sitzungskennung erneut geprüft; Änderungen an Website-Cookies blenden sichtbare
Daten aus, wenn sich die Kennung ändert. Das Trennen der nativen Verbindung
löscht private Caches, das Schliessen des Tabs entfernt den Tab-Speicher. Benötigt
einen aktualisierten Companion in einem normalen Chrome-/Firefox-Fenster;
private Fenster und Firefox-Container werden für diesen Abruf nicht unterstützt.
Die offizielle Liste bleibt als Alternative verfügbar.

Ab Companion 1.2.1 kannst du die Website-Anmeldung in einem offiziellen Tab
abschliessen. Die Erweiterung speichert dafür nur Tab-IDs, BetterIlias-Ursprung,
native Verbindungskennung/Zugehörigkeit, festen Rückkehrpfad und eine
Zehn-Minuten-Frist im flüchtigen Erweiterungsspeicher. Sie beobachtet die
Rückkehr zu ZSSW und setzt den angeforderten Listenabruf fort. Sie liest weder
die SWITCH-Identitätsauswahl noch Passwörter oder SAML-Antworten. Abschluss,
Abbruch und Trennen entfernen den Vorgang; abgelaufene Vorgänge werden ignoriert
und beim nächsten Start entfernt.

Persönliche native Anmeldungen werden zusätzlich auf dem Server mit einer Minute
Gültigkeit unter privaten Dateirechten gespeichert, getrennt nach Hash der
Verbindungskennung, Anmeldung, Zugehörigkeit und Sprache. Tokens werden nicht in
diesen Cache kopiert. Gleichzeitige Abrufe werden zusammengeführt; ausdrückliches
Aktualisieren umgeht ältere Einträge. Buchungen verwerfen die zwischengespeicherten
Listen des Kontos vor und nach dem Senden und Prüfen des Ergebnisses. Die
Berechtigungs- und Buchungsprüfung ruft stets frische Daten ab. Abgelaufene
Cache-Einträge werden beim nächsten Zugriff entfernt; das Trennen löscht die
Cache-Einträge der Verbindung.
