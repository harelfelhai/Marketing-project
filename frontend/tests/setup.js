/**
 * tests/setup.js — Global test setup, loaded before every test.
 *
 * Only one job today: install @testing-library/jest-dom's custom matchers
 * (toBeInTheDocument, toHaveClass, etc.) so component tests can use them.
 */

import '@testing-library/jest-dom';
