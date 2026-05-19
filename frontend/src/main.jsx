/**
 * main.jsx — React 18 entry point.
 *
 * Mounts the app, wraps the tree in <BrowserRouter>, and stacks the three
 * global context providers in the order they depend on:
 *   1. MockAuthProvider   — operator identity (read-only)
 *   2. MockDataProvider   — in-memory db (depends on nothing)
 *   3. UIProvider         — modal / toast / filter state (independent)
 *
 * No provider here reads from another — order is alphabetical/logical only.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { MockAuthProvider } from './contexts/MockAuthContext';
import { MockDataProvider } from './contexts/MockDataContext';
import { UIProvider } from './contexts/UIContext';

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <MockAuthProvider>
        <MockDataProvider>
          <UIProvider>
            <App />
          </UIProvider>
        </MockDataProvider>
      </MockAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
