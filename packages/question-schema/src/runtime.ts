/**
 * Web-platform globals that exist in every runtime we ship to (browsers, Node 22, Hermes) but not
 * in this package's `lib`/`types` configuration, typed locally so the package needs neither DOM
 * nor Node typings (the same approach as `@quizparty/validation`).
 */
interface Runtime {
  URL: new (input: string) => { protocol: string; username: string; password: string };
  btoa(data: string): string;
  atob(data: string): string;
  TextEncoder: new () => { encode(input: string): Uint8Array };
}

const runtime = globalThis as unknown as Runtime;

export const parseUrl = (input: string) => new runtime.URL(input);
export const toBase64 = (binary: string): string => runtime.btoa(binary);
export const fromBase64 = (encoded: string): string => runtime.atob(encoded);
export const utf8 = (text: string): Uint8Array => new runtime.TextEncoder().encode(text);
