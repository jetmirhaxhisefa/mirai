import type { Task } from '../api';
import { TaskList } from './TaskList';

const tasks: Task[] = [
  { id: 1, title: 'Write the report', done: false },
  { id: 2, title: 'Book the room', done: true },
];

export default function TaskListDemo() {
  return <TaskList tasks={tasks} onComplete={() => {}} />;
}

export function Empty() {
  return <TaskList tasks={[]} onComplete={() => {}} />;
}
