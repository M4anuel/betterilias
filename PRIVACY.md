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
Chrome/Firefox shared-login processing is described in section 5. The cookie-export
details below apply only to the explicitly selected deprecated fallback; Safari
retains that browser-cookie workflow.

The **BetterIlias Companion** extension (for Chrome, Firefox and Safari) only accesses and processes data strictly necessary to connect your authenticated University of Bern ILIAS session (`https://ilias.unibe.ch`) with BetterIlias (`https://betterilias.ch`):

* **Authentication Information (`cookies` on `https://ilias.unibe.ch`):** When you sign in to `ilias.unibe.ch` or trigger synchronization, the extension reads your active ILIAS session cookies (`PHPSESSID` and `ilClientId`) from `https://ilias.unibe.ch` and transmits them over encrypted HTTPS (TLS) to `https://betterilias.ch/api/auth/sync` so BetterIlias can retrieve your lectures, course materials, and exercises on your behalf.
* **Local Extension Storage (`storage.local`):** The extension stores your BetterIlias session identifier (`session_id`), last synchronization timestamp, and auto-sync preference locally inside your browser.
* **Tab Handoff (`tabs` & content script on `https://betterilias.ch`):** The extension detects open `https://betterilias.ch` tabs to hand off your active BetterIlias session identifier without requiring a manual login form.

### 3. What Is Not Collected
* **No Passwords:** Neither the extension nor BetterIlias ever reads, collects, or stores your University of Bern / Switch edu-ID password.
* **No Browsing History or Advertising Trackers:** The extension accesses ILIAS, the configured BetterIlias instance and, for the opt-in UniSport prototype in Chrome/Firefox, SWITCH login completion at `https://login.eduid.ch`. It does not collect browsing history or use advertising trackers.
* **No Third-Party Sharing or Sale:** User data is never sold, rented, or transferred to third parties, and is never used for advertising or creditworthiness assessment.

### 4. Server Processing, Retention & Deletion
* **Isolated Sessions:** Session cookies forwarded to `https://betterilias.ch` are stored in isolated per-session storage and are used exclusively to proxy your own requests to `https://ilias.unibe.ch`. Expired or logged-out sessions are deleted automatically.
* **Hosting Location:** The server is hosted in an ISO-27001-certified datacenter in Nuremberg, Germany (EU), with end-to-end TLS encryption.
* **Deletion:** Use the relevant connection's **Disconnect / Log out** action in BetterIlias to remove its server-side credentials. Uninstalling the extension does not itself revoke server-side sessions.

When the instance has an enabled administrator dashboard, actual authenticated app use records a verified account identifier, display name and last-use timestamp in a private server-side usage index. The identifier is an instance-specific keyed hash of the verified SWITCH issuer, client and subject; raw subjects and provider tokens are not stored in this index. Administrators can see distinct-account totals and explicitly open/search the names. This counts accounts, not guaranteed individual people; legacy cookie-only connections are not attributed. Names and usage records expire 30 days after the last app use. Cleanup runs on access and every five minutes while the backend runs. Login/status polling does not extend retention. The Companion shows this purpose and retention before login when collection is enabled. No names enter diagnostic events, public endpoints or persistent browser analytics storage. The index is bounded to 10,000 most recently used accounts; older rows can be removed earlier at that limit.

### 5. Shared UniBE Login (Chrome / Firefox)
Companion 1.4.0 / BetterIlias 1.9.0 use one UniBE login for ILIAS and optional
UniSport. You sign in directly on SWITCH's website. The Companion observes only
the native callback in its own login tab and sends the authorization code to
your configured BetterIlias instance. It reads no passwords, MFA codes or login
form inputs. The backend verifies the signed ID token, retains its bounded name
and expiry, and reads affiliations from `api.uniapp-backend.unibe.ch`.

The Companion shows your verified name and affiliation choices while connected.
Only the domain after `@` is displayed; the full affiliation is submitted to the
backend when you confirm. On request, the server sends its token and affiliation
only to the fixed UniBE ILIAS mobile-auth entry/exact alias. Cookie-only own-profile
verification proves the unique ILIAS account before credentials are saved.
Verified same-account renewal preserves caches; different/unmatched accounts
require confirmation and isolated cache ownership. Failure keeps existing ILIAS
credentials intact. Initial SWITCH login still requires the Companion.

Provider ID/refresh tokens are not stored in the extension or webpage; no refresh
token is retained by the backend. Extension local storage contains configured
instance settings, per-instance BetterIlias capabilities and display metadata.
The page stores its random connection capability in localStorage. Pending callback
state/tab ownership is in browser session storage for at most ten minutes of
validity. The private backend database contains a capability hash, pending PKCE/
nonce state, and then the ID token, subject, verified name, affiliation and expiry.
UniBE connections expire at token expiry or after one hour, whichever comes first.
Disconnect deletes that login; an established ILIAS session is independent and
can be logged out separately. Closing/uninstalling the extension does not revoke
backend sessions or log out SWITCH. Safari does not include shared UniBE login.

Browser-cookie export is deprecated and disabled in the default shared mode.
The explicit advanced fallback still processes ILIAS auth cookies and selects a
separate verified browser connection. The per-origin source preference and
cache-owner checks prevent automatic cookie sync replacing the UniBE selection.
The previous protocol and recovery details are preserved in
[legacy login documentation](docs/LEGACY_ILIAS_LOGIN.md).

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
Die gemeinsame Chrome-/Firefox-Anmeldung wird in Abschnitt 5 beschrieben. Die
folgenden Angaben zum Cookie-Export gelten nur für den ausdrücklich gewählten,
veralteten Ersatzweg. Safari verwendet weiterhin diese Cookie-Anmeldung.

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

Wenn das Administrator-Dashboard der Instanz aktiviert ist, werden bei tatsächlicher authentifizierter App-Nutzung eine verifizierte Kontokennung, der Anzeigename und der letzte Nutzungszeitpunkt in einem privaten serverseitigen Nutzungsindex gespeichert. Die Kennung ist ein instanzspezifischer HMAC aus verifiziertem SWITCH-Aussteller, Client und Subject; rohe Subjects und Anbieter-Tokens werden dort nicht gespeichert. Administratoren sehen die Anzahl verschiedener Konten und können die Namen ausdrücklich öffnen und durchsuchen. Gezählt werden Konten, nicht zwingend einzelne Personen; alte reine Cookie-Verbindungen werden nicht zugeordnet. Namen und Nutzungseinträge werden 30 Tage nach der letzten App-Nutzung gelöscht. Die Bereinigung erfolgt bei Zugriffen und alle fünf Minuten während des Backend-Betriebs. Anmeldung und Statusabfragen verlängern diese Frist nicht. Der Companion zeigt Zweck und Frist vor der Anmeldung an, wenn die Erfassung aktiviert ist. Namen erscheinen weder in Diagnoseereignissen noch in öffentlichen Endpunkten oder einem dauerhaften Browser-Analysespeicher. Der Index ist auf die 10'000 zuletzt genutzten Konten begrenzt; am Limit können ältere Einträge früher entfernt werden.

### 5. Gemeinsame UniBE-Anmeldung (Chrome / Firefox)
Companion 1.4.0 / BetterIlias 1.9.0 verwenden eine UniBE-Anmeldung für ILIAS und
optional UniSport. Du meldest dich direkt auf der SWITCH-Webseite an. Der
Companion erkennt nur die native Anmeldeantwort im eigenen Anmelde-Tab und sendet
den Autorisierungscode an deine konfigurierte BetterIlias-Instanz. Er liest keine
Passwörter, MFA-Codes oder Eingaben in Anmeldeformularen. Das Backend prüft das
signierte ID-Token, speichert den begrenzten Anzeigenamen und die Ablaufzeit und
ruft Zugehörigkeiten bei `api.uniapp-backend.unibe.ch` ab.

Der Companion zeigt deinen bestätigten Namen und die verfügbaren Zugehörigkeiten.
Sichtbar ist nur die Domain nach `@`; beim Bestätigen wird die vollständige
Zugehörigkeit verwendet. Auf Wunsch sendet der Server Token und Zugehörigkeit
ausschliesslich an den festen UniBE-ILIAS-Mobile-Auth-Einstieg bzw. dessen exakten
Alias. Ein separater Abruf des eigenen Profils mit Cookies prüft das eindeutige
ILIAS-Konto vor dem Speichern. Beim Erneuern desselben bestätigten Kontos bleiben
Caches erhalten. Ein anderes oder nicht sicher zugeordnetes Konto erfordert eine
Bestätigung und getrennte Cache-Zuordnung. Fehler ersetzen keine bestehenden
ILIAS-Zugangsdaten. Die erste SWITCH-Anmeldung benötigt weiterhin den Companion.

Provider-ID-/Refresh-Tokens werden weder in der Erweiterung noch auf der Webseite
gespeichert; auch das Backend behält kein Refresh-Token. Der lokale
Erweiterungsspeicher enthält Instanz-Einstellungen, instanzbezogene zufällige
BetterIlias-Zugangskennungen und Anzeigedaten. Die Webseite speichert ihre
zufällige Verbindungskennung in localStorage. Ausstehende Anmeldedaten und
Tab-Zuordnungen liegen höchstens zehn Minuten gültig im Browser-Sitzungsspeicher.
Die private Backend-Datenbank enthält einen Kennungs-Hash, PKCE-/Nonce-Daten und
anschliessend ID-Token, Kontokennung, bestätigten Namen, Zugehörigkeit und Ablauf.
UniBE-Verbindungen laufen mit dem Token, spätestens nach einer Stunde ab. Trennen
löscht diese Anmeldung; eine bestehende ILIAS-Sitzung bleibt unabhängig und kann
separat abgemeldet werden. Schliessen oder Deinstallieren des Companions widerruft
keine Backend-Sitzung und meldet nicht bei SWITCH ab. Safari unterstützt diese
gemeinsame UniBE-Anmeldung nicht.

Der Browser-Cookie-Export ist veraltet und im gemeinsamen Standardmodus inaktiv.
Der ausdrücklich gewählte erweiterte Rückfallweg verarbeitet weiterhin
ILIAS-Anmelde-Cookies und wählt eine separat bestätigte Browser-Verbindung.
Quellenauswahl und Cache-Zuordnung verhindern, dass automatische Cookie-Synchronisation
die UniBE-Auswahl ersetzt. Protokoll und Wiederherstellung stehen in der
[Dokumentation zur veralteten Anmeldung](docs/LEGACY_ILIAS_LOGIN.md).

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
