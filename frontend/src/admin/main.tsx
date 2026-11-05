import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminDashboard } from './Dashboard';
import { theme } from '../lib/theme';
import '../index.css';
import './admin.css';

theme.applyTheme();
createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminDashboard /></React.StrictMode>);
