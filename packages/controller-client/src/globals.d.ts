/**
 * Timer functions exist in browsers, Node and React Native. This package compiles without DOM or
 * Node typings (so UI-only globals cannot leak into shared code), hence the narrow declaration.
 */
declare function setTimeout(handler: () => void, ms?: number): number;
declare function clearTimeout(handle: number | undefined): void;
declare function setInterval(handler: () => void, ms?: number): number;
declare function clearInterval(handle: number | undefined): void;
