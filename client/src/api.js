import axios from 'axios';

const envBase = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE ? import.meta.env.VITE_API_BASE : null;
const host = typeof window !== 'undefined' ? window.location.hostname : '';
const baseURL = host.endsWith('.vercel.app') ? '/api' : (envBase || 'http://localhost:4000');
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
