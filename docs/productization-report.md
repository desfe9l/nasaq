# Productization Report

## Current architecture

- React 19 + TanStack Start/Router with file routes under `src/routes`.
- The editor is an existing client-side system: Zustand state in `src/lib/editor/store.ts`, model in `src/lib/editor/model.ts`, templates in `src/lib/editor/templates.ts`, and DOM/model-based exporters in `src/lib/editor/export.ts`.
- Projects and reusable assets are stored locally in IndexedDB with a localStorage fallback.
- Word and PowerPoint have editable scene-based exporters; PDF/PNG/JPG use DOM raster capture. The editor has no remote project API in the current demo.
- Better Auth and database wiring exist in the repository, but the current application path is not an accounts product and must not silently turn on auth or database access.

## Productization decisions

- The public experience is a controlled Demo around the existing editor. Demo data is local and fictional; no private customer data or secrets are exposed.
- Licensing is represented by typed records and centralized entitlements in `src/lib/product/product.ts`. The current `DEMO_LICENSE` is explicitly local and is not a security boundary.
- A commercial deployment must replace the local record with server-issued, verified license claims. Feature checks must be enforced server-side for protected APIs and exports when those APIs are introduced.
- Brand Kit is intentionally a document-design concept, separate from the editor UI theme. The current local Brand Kit is a preparation layer for future organization-scoped persistence.
- Contact/sales is a safe handoff flow. No payment processor, private API, or credentials are added.

## Security findings

- No committed `.env` or obvious API credential was found in the source scan. The repository contains generated `.vercel/output`; it should not be committed or published as source.
- IndexedDB/localStorage is appropriate for a local Demo but is not suitable for sensitive organizational data, shared projects, or access control.
- Client-side Demo entitlements can be inspected or changed by a user. They are UX/product boundaries only until a server validates licenses.
- If a public repository contains the complete commercial source, move commercial-only templates, server code, license signing keys, and organization data services to a private repository. Do not put signing keys in `VITE_*` variables.

## Deployment options

1. Hosted Demo: current Vercel-compatible build with local-only storage and fictional sample content.
2. Licensed Hosted Version: add authenticated server APIs, organization-scoped storage, signed license claims, audit logs, and server-side export/feature enforcement.
3. Private deployment: deploy the same application and server APIs inside the customer environment with customer-controlled storage and secrets.
4. On-premise: package the application and its database/API services for the organization's infrastructure after a separate security review.

The current project does not claim government cybersecurity compliance. Deployment can be adapted to the organization's technical and security requirements.

## Legal placeholders

The project still needs reviewed, organization-specific documents for Commercial License, Terms of Use, Privacy Policy, Demo Terms, Enterprise License, and third-party licenses. Existing third-party package licenses must remain governed by their package terms.
