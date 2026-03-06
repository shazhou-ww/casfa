# @casfa/cell-delegates-server

Server-side delegate management routes for business cells: list, create, revoke.

- **createDelegatesRoutes(deps)**: Returns Hono routes for GET/POST `/api/delegates` and POST `/api/delegates/:id/revoke`.
- **deps**: `{ oauthServer: OAuthServer; getUserId: (auth) => string }`. `getUserId` returns the realm owner id (e.g. `auth.type === "user" ? auth.userId : auth.realmId`).
- Requires auth with `manage_delegates` (user or delegate with that permission).

Depends on `@casfa/cell-oauth` (OAuthServer). Mount the returned app on your business cell backend.
