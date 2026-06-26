# @voai/founder-mobile

React Native mobile app for founders. The primary surface for VirtualOffice AI.

## Status

**Not yet scaffolded.** Sprint 1.3.1 (Sign-up to home dashboard flow) populates
this directory with the React Native skeleton.

## When this is built

Sprint 1.3.1 — Phase 1, Sprint 1.3 — Onboarding flow (basic).

Output: Mobile app skeleton in React Native. Sign-up screen. Onboarding screens
(Quick Start path). Home dashboard skeleton (empty state). First mobile app build
runnable on iOS and Android.

## Why it sits in the monorepo

Sharing types between the mobile client and the backend (especially
`@voai/types`) means the app cannot drift from the API contract. The monorepo
holds the source of truth for that contract.
