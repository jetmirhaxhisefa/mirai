import { useState, type FormEvent } from 'react';

export const MAX_TITLE_LENGTH = 120;

type Props = { onAdd: (title: string) => Promise<void> };

export function AddTaskForm({ onAdd }: Props) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (trimmed === '') return setError('A title is required.');
    if ([...trimmed].length > MAX_TITLE_LENGTH) return setError(`At most ${MAX_TITLE_LENGTH} characters.`);
    setError(null);
    try {
      await onAdd(trimmed);
      setTitle('');
    } catch {
      setError('The task could not be saved. Try again.');
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add task" data-testid="add-task-form">
      <label>
        New task
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button type="submit">Add</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
