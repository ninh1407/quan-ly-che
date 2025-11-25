import axios from 'axios';

const envBase = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_API_BASE) ? import.meta.env.VITE_API_BASE : null;
let baseURL = envBase || null;
if (!baseURL) {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || 'localhost';
    baseURL = `${window.location.protocol}//${host}:4000`;
  } else {
    baseURL = 'http://localhost:4000';
  }
}
const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
let __logoutOnce = false;
api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    const status = error?.response?.status;
    const hadToken = !!localStorage.getItem('token');
    if (status === 401 && hadToken && !__logoutOnce) {
      __logoutOnce = true;
      try { localStorage.removeItem('token'); localStorage.removeItem('role'); localStorage.removeItem('roles'); localStorage.removeItem('username'); } catch {}
      if (typeof window !== 'undefined') {
        const url = window.location.origin + window.location.pathname;
        window.location.replace(url);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
