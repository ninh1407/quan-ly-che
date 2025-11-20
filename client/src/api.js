import axios from 'axios';

const envBase = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE ? import.meta.env.VITE_API_BASE : null;
const baseURL = envBase || 'http://20.205.30.184:8080';
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
