## Private M4B pilot activation

Use the existing V17 host, private Drive OAuth configuration and verified ready registry. Apply
`numbered-drive-m4b-mp4.patch` to the pinned V17 source copy used by the pilot. Register CARAVANSERAI's six numbered files via the private folder import. Keep its Supabase catalog flag inactive.

Generate the server-only mapping for each edition using
`node staging/v17/build-edition.mjs ready-row.json catalog-edition.json archive-receipt.json`.
Combine mappings by edition ID in V17_VERIFIED_EDITIONS. Use the current builder so that every
guest part includes its verified hash. Use V17_PRIVATE_ORIGIN and V17_OWNER_LISTENER_ID for
the original Tailscale path. The inactive CARAVANSERAI edition is reserved for the owner.

For the guest smoke test, use an already active edition assigned to the test listener. Expose
only GET/HEAD /guest-m4b/ on an approved existing guest-facing HTTPS reverse proxy. Forward that
prefix to a separate unused loopback port, disable request URI/access logging, caching and
response buffering, preserve Range and Content-Range, and rate-limit requests at the ingress.
Do not forward to the owner service or publish a Tailscale Funnel. If there is no suitable
cost-free guest ingress, leave the rollout disabled.

Run guest_media.py as the existing unprivileged V17 service user in a separate process with
PYTHONPATH pointing to the matching patched V17 module directory, V17_REGISTRY set to the
existing V17 books.sqlite3, V17_GUEST_PORT set to the chosen loopback port and
V17_GUEST_TICKET_KEY set through the private service environment to 32 random bytes in lowercase
hex. Keep the same key in the pilot audio-library Edge function environment. Never log tokens or
put keys into Git. Set V17_GUEST_ORIGIN to the guest HTTPS origin without a trailing slash.
Enable V17_GUEST_LISTENER for one authenticated listener. The existing title grant is required
even for this pilot listener. A ticket is valid for new byte-range requests for five minutes.
Already-admitted responses can finish; renewal rechecks book and listener rights.

Deploy the branch assets together with the matching pilot Edge function to an isolated entry.
For a differently named pilot function, set the pilot copy's AUDIO_API to that deployment before
serving it. Keep the production entry and Edge version as rollback. On iPhone, open the pilot
entry with Tailscale as owner; play across a part boundary, then reopen and resume. Separately
confirm the guest can play an assigned edition without Tailscale. Widen V17_GUEST_LISTENER to
* only after acceptance and verified mappings for the target editions. Clearing it disables
guest M4B issuance. Rotate the guest key to invalidate outstanding tickets if necessary.
