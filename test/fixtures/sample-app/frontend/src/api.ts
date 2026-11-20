import axios from 'axios';

export type Task = { id: number; title: string; done: boolean };
export type User = { id: number; name: string; email: string };

// Sanctum SPA auth: axios sends the XSRF-TOKEN cookie back as a header.
const http = axios.create({ withCredentials: true, withXSRFToken: true, headers: { Accept: 'application/json' } });

export async function login(email: string, password: string): Promise<User> {
  await http.get('/sanctum/csrf-cookie');
  return (await http.post<User>('/api/login', { email, password })).data;
}

export async function currentUser(): Promise<User | null> {
  try {
    return (await http.get<User>('/api/user')).data;
  } catch {
    return null;
  }
}

export const listTasks = async () => (await http.get<Task[]>('/api/tasks')).data;
export const addTask = async (title: string) => (await http.post<Task>('/api/tasks', { title })).data;
export const completeTask = async (id: number) => (await http.patch<Task>(`/api/tasks/${id}`)).data;
