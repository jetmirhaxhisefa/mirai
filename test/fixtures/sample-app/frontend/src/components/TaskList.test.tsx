import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskList } from './TaskList';

describe('TaskList', () => {
  it('shows an empty state', () => {
    render(<TaskList tasks={[]} onComplete={vi.fn()} />);
    expect(screen.getByTestId('empty-tasks')).toBeInTheDocument();
  });

  it('completes an open task and locks a done one', async () => {
    const onComplete = vi.fn();
    render(
      <TaskList
        tasks={[
          { id: 1, title: 'Open', done: false },
          { id: 2, title: 'Closed', done: true },
        ]}
        onComplete={onComplete}
      />,
    );
    await userEvent.click(screen.getByLabelText('Done: Open'));
    expect(onComplete).toHaveBeenCalledWith(1);
    expect(screen.getByLabelText('Done: Closed')).toBeDisabled();
  });
});
