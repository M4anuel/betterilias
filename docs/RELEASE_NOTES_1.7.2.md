# 1.7.2 — Hide UniSport unless enabled on the server

The frontend now reads a public, non-cacheable availability flag from the
backend. UniSport stays hidden until the server explicitly reports it enabled;
unset/false `UNISPORT_ENABLED` and failed availability checks leave it hidden.
The sidebar, sidebar customisation and direct `?view=unisport` entry all respect
the flag. Disabled direct links show the landing page without mounting UniSport
or fetching its catalogue/connection. Existing sidebar preferences are retained.

Set `UNISPORT_ENABLED=true` in the server's `.env` and restart the backend to
enable it, then reload the page. No frontend build-time environment flag is needed.
