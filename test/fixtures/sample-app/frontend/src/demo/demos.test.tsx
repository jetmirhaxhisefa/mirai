import { render } from '@testing-library/react';
import type { ComponentType } from 'react';
import { findMissingDemos } from './coverage';
import componentsDoc from '../../COMPONENTS.md?raw';

const componentFiles = Object.keys(import.meta.glob('../components/*.tsx'));
const demoModules = import.meta.glob<{ default?: ComponentType; Empty?: ComponentType }>(
  '../components/*.demo.tsx',
  { eager: true },
);

const baseName = (path: string) => path.split('/').pop()!.replace(/\.tsx$/, '');
const componentNames = componentFiles
  .map(baseName)
  .filter((n) => !n.includes('.test') && !n.includes('.demo'));

it('every component has a demo', () => {
  expect(componentNames.length).toBeGreaterThan(0);
  expect(findMissingDemos(componentFiles)).toEqual([]);
  for (const name of componentNames) {
    expect(demoModules[`../components/${name}.demo.tsx`], `${name} has no demo`).toBeDefined();
  }
});

it('a missing demo is named', () => {
  expect(findMissingDemos(['A.tsx', 'A.demo.tsx', 'B.tsx'])).toEqual(['B']);
});

it('test and demo files are not components', () => {
  expect(findMissingDemos(['X.test.tsx', 'Y.demo.tsx', 'Y.tsx', 'Y.test.tsx'])).toEqual([]);
});

it('every demo and Empty renders without network', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('network');
  });
  const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
  expect(componentNames.length).toBeGreaterThan(0);
  for (const name of componentNames) {
    const mod = demoModules[`../components/${name}.demo.tsx`];
    expect(mod, `${name} has no demo`).toBeDefined();
    expect(mod?.default, `${name} demo has no default export`).toBeTypeOf('function');
    expect(mod?.Empty, `${name} demo has no Empty export`).toBeTypeOf('function');
    for (const [label, Demo] of [['default', mod?.default], ['Empty', mod?.Empty]] as const) {
      if (!Demo) continue;
      expect(() => render(<Demo />), `${name} ${label} demo throws`).not.toThrow();
    }
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
  xhrSpy.mockRestore();
});

it('COMPONENTS.md has a Demos section', () => {
  const match = /^## Demos[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(componentsDoc);
  expect(match, 'COMPONENTS.md has no "## Demos" heading').not.toBeNull();
  const body = match?.[1] ?? '';
  expect(body, 'Demos section is empty').toMatch(/\S/);
  expect(body).toContain('.demo.tsx');
  expect(body).toContain('src/demo/demos.test.tsx');
});
