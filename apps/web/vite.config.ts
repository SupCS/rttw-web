import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } };
export default defineConfig({ plugins: [react()], server: { proxy }, preview: { proxy } });
