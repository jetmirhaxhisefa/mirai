import type { Task } from '../api';

type Props = { tasks: Task[]; onComplete: (id: number) => void };

export function TaskList({ tasks, onComplete }: Props) {
  if (tasks.length === 0) return <p data-testid="empty-tasks">No tasks yet.</p>;

  return (
    <ul aria-label="Tasks" data-testid="task-list">
      {tasks.map((task) => (
        <li key={task.id} data-testid={`task-${task.id}`}>
          <label>
            <input
              type="checkbox"
              checked={task.done}
              disabled={task.done}
              onChange={() => onComplete(task.id)}
              aria-label={`Done: ${task.title}`}
            />
            {task.title}
          </label>
        </li>
      ))}
    </ul>
  );
}
