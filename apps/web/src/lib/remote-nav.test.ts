import { afterEach, describe, expect, it, vi } from 'vitest';
import { installRemoteNavigation, pickNext, type Box } from './remote-nav';

const box = (left: number, top: number, width = 100, height = 50): Box => ({
  left,
  top,
  width,
  height,
});

describe('pickNext', () => {
  const grid = [box(0, 0), box(200, 0), box(0, 100), box(200, 100)];

  it('moves to the neighbour in the pressed direction', () => {
    expect(pickNext(grid[0]!, grid, 'right')).toBe(1);
    expect(pickNext(grid[0]!, grid, 'down')).toBe(2);
    expect(pickNext(grid[3]!, grid, 'left')).toBe(2);
    expect(pickNext(grid[3]!, grid, 'up')).toBe(1);
  });

  it('returns -1 at an edge', () => {
    expect(pickNext(grid[0]!, grid, 'left')).toBe(-1);
    expect(pickNext(grid[0]!, grid, 'up')).toBe(-1);
    expect(pickNext(grid[3]!, grid, 'right')).toBe(-1);
    expect(pickNext(grid[3]!, grid, 'down')).toBe(-1);
  });

  it('prefers the target straight ahead over a nearer one far off to the side', () => {
    const from = box(400, 400);
    // The first is only 100 px up but 400 px to the left; the second is 200 px straight up.
    expect(pickNext(from, [box(0, 300), box(400, 200)], 'up')).toBe(1);
    // A slightly sideways but much nearer target still wins over a far straight one.
    expect(pickNext(from, [box(380, 300), box(400, 100)], 'up')).toBe(0);
  });
});

describe('installRemoteNavigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup() {
    const root = document.createElement('div');
    root.innerHTML =
      '<button data-focusable id="a">a</button><button data-focusable id="b">b</button>';
    document.body.append(root);
    return root;
  }

  it('focuses the first control on the first arrow key', () => {
    const root = setup();
    const stop = installRemoteNavigation(root);
    // jsdom has no layout: offsetParent is always null, so make the controls look rendered.
    for (const element of root.querySelectorAll('button'))
      Object.defineProperty(element, 'offsetParent', { value: root });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
    expect(document.activeElement?.id).toBe('a');
    stop();
  });

  it('keeps focus inside an open dialog', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<button data-focusable id="behind">behind</button>' +
      '<div role="dialog" aria-modal="true"><button data-focusable id="inside">inside</button></div>';
    document.body.append(root);
    for (const element of root.querySelectorAll('button'))
      Object.defineProperty(element, 'offsetParent', { value: root });
    const stop = installRemoteNavigation(root);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(document.activeElement?.id).toBe('inside');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }));
    expect(document.activeElement?.id).toBe('inside'); // nothing else to go to
    stop();
  });

  it('calls onBack for Escape, GoBack and the TV back keycodes', () => {
    const root = setup();
    const onBack = vi.fn();
    const stop = installRemoteNavigation(root, onBack);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 10009 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 461 }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(onBack).toHaveBeenCalledTimes(4);
    stop();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onBack).toHaveBeenCalledTimes(4);
  });
});
