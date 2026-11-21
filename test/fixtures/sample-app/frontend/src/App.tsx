import { useEffect, useState } from 'react';
import { addTask, completeTask, currentUser, listTasks, login, type Task, type User } from './api';
import { AddTaskForm } from './components/AddTaskForm';
import { LoginForm } from './components/LoginForm';
import { TaskList } from './components/TaskList';

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    currentUser().then(setUser);
  }, []);

  useEffect(() => {
    if (user) listTasks().then(setTasks);
  }, [user]);

  if (user === undefined) return <p>Loading…</p>;
  if (user === null) return <LoginForm onLogin={async (e, p) => setUser(await login(e, p))} />;

  return (
    <main>
      <h1>Tasks for {user.name}</h1>
      <AddTaskForm
        onAdd={async (title) => {
          const task = await addTask(title);
          setTasks((all) => [task, ...all]);
        }}
      />
      {error && <p role="alert">{error}</p>}
      <TaskList
        tasks={tasks}
        onComplete={async (id) => {
          try {
            const done = await completeTask(id);
            setTasks((all) => all.map((t) => (t.id === id ? done : t)));
            setError(null);
          } catch {
            setError('The task could not be updated. Try again.');
          }
        }}
      />
    </main>
  );
}
