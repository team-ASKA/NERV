# Testing

**Framework & Setup**
-   The codebase currently **lacks a prominent testing framework** such as Jest, Vitest, or Cypress in its `package.json` config.
-   Testing seems primarily manual or handled via execution-level scripts.

**Ad-hoc Test Scripts**
-   Numerous Node.js scripts exist in the root directory beginning with `test_` or `test-` (`test-did.js`, `test-did-talks.js`, `test_sarvam.js`, `test_summary.js`). 
-   These scripts indicate an ad-hoc, "playground" approach to testing individual third-party integrations (like D-ID pipelines or Sarvam models) by executing them sequentially in Node rather than asserting within a defined test suite.

**Coverage**
-   Automated unit testing and integration testing coverage is essentially 0%.
-   UI components do not possess corresponding `.test.tsx` or `.spec.tsx` counterparts.
