# Frontend components

The components the task app is built from, in src/components:

- AddTaskForm: adds a task.
- LoginForm: signs a user in.
- TaskList: lists, completes and deletes tasks.

## Demos

Each component has a demo beside it, as `<Name>.demo.tsx` in `src/components`. A demo renders the component with fixed data and exports `Empty`, which renders it with no data.

The test in `src/demo/demos.test.tsx` fails when a component has no demo or a demo does not render.
