import { Store, type KeyValueStorage } from '@quizparty/controller-client';
import type { Locale } from '@quizparty/protocol';
import type { AccountView, ApiClient } from './api';

export interface AuthState {
  status: 'LOADING' | 'SIGNED_OUT' | 'SIGNED_IN';
  account: AccountView | null;
}

const TOKEN_KEY = 'qp.account.token';

/**
 * The account session on this device: an opaque bearer token in secure storage (ADR-0012). Players
 * never need it; it exists for buying the full game and for the profile screen. The token is only
 * ever sent to our own API.
 */
export class AuthStore {
  readonly store = new Store<AuthState>({ status: 'LOADING', account: null });
  private token: string | null = null;

  private client: ApiClient | null = null;

  private readonly storage: KeyValueStorage;

  constructor(storage: KeyValueStorage) {
    this.storage = storage;
  }

  /** The API client and the store need each other (token out, 401 in), so one is attached to the other. */
  attach(api: ApiClient): void {
    this.client = api;
  }

  get state(): AuthState {
    return this.store.get();
  }

  currentToken = (): string | null => this.token;

  private get api(): ApiClient {
    if (!this.client) throw new Error('AuthStore has no ApiClient attached');
    return this.client;
  }

  /** Loads a stored token and confirms it with the server; an invalid token is dropped. */
  async restore(): Promise<void> {
    this.token = (await this.storage.get(TOKEN_KEY)) ?? null;
    if (!this.token) {
      this.store.set({ status: 'SIGNED_OUT', account: null });
      return;
    }
    try {
      const account = await this.api.me();
      this.store.set({ status: 'SIGNED_IN', account });
    } catch (error) {
      // Offline at launch keeps the token (we do not know it is bad); a refusal drops it.
      const code = (error as { code?: string }).code;
      if (code === 'NETWORK') this.store.set({ status: 'SIGNED_OUT', account: null });
      else await this.clear();
    }
  }

  requestCode(email: string, locale: Locale): Promise<void> {
    return this.api.requestEmailCode(email, locale);
  }

  async verifyCode(email: string, code: string): Promise<AccountView> {
    const { account, token } = await this.api.verifyEmailCode(email, code);
    this.token = token;
    await this.storage.set(TOKEN_KEY, token);
    this.store.set({ status: 'SIGNED_IN', account });
    return account;
  }

  /** Revokes the session on the server (best effort) and forgets it here. */
  async signOut(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // the token is dropped locally either way
    }
    await this.clear();
  }

  async clear(): Promise<void> {
    this.token = null;
    await this.storage.remove(TOKEN_KEY);
    this.store.set({ status: 'SIGNED_OUT', account: null });
  }
}
